"""Build a Place fixture (points + walking edges on real streets).

Run by hand for each place (a bbox that starts with a minus sign needs `--`
before it, for example `fetch_place.py name -- -33.9,18.4,-33.8,18.5`):

    python scripts/fetch_place.py kadikoy 40.982,29.020,40.996,29.040

`--kind` chooses what the points are (default `cafe`, which is the Kadikoy
fixture and writes exactly the file it always did):

    cafe         amenity=cafe (nodes, ways, relations). Walking rule 150 m.
    bus_stop     nodes with highway=bus_stop. Stops that share a name and lie
                 within 40 m of each other (the two sides of one street) are
                 merged into one point at their middle. Rule 244 m (800 ft).
    bike_share   amenity=bicycle_rental. Rule 305 m (1,000 ft).

    python scripts/fetch_place.py sf_bus_stops 37.755,-122.425,37.770,-122.405 --kind bus_stop
    python scripts/fetch_place.py nyc_bike_share 40.720,-74.005,40.735,-73.985 --kind bike_share

One Overpass request, then the pure functions below, then one JSON file.
Standard library only. The fetch function is a parameter of `run`, so tests
can replace it and never touch the network.

Coordinates: local metres, x east and y north of the centroid of the points,
rounded to 0.1 m (equirectangular projection).
"""

from __future__ import annotations

import argparse
import datetime
import heapq
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

EARTH_RADIUS_M = 6371008.8
WALK_LIMIT_M = 150.0
_EPS = 1e-9

# Minimum point count (after merging bus stops). It only catches a broken or
# empty download. It is not a quality bar: any count of 20 or more is accepted
# and stored as it is.
MIN_POINTS = 20
MIN_CAFES = MIN_POINTS  # the old name

# Bus stops: stops with the same name that are all within this many metres of
# each other are one stop (two directions of one street), merged at their middle.
MERGE_RADIUS_M = 40.0

OVERPASS_ENDPOINT = "https://lz4.overpass-api.de/api/interpreter"
# Tried in this order in every round. --endpoint forces a single one.
# overpass.openstreetmap.fr is left out on purpose: it answers 403 (white-listed use only).
OVERPASS_ENDPOINTS = (
    OVERPASS_ENDPOINT,
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
# Seconds to wait after a failed round 1, 2 (no wait after the last round).
RETRY_WAITS_S = (30, 60, 120)
RETRY_ROUNDS = 3
OVERPASS_TIMEOUT_S = 180
CAFE_FILTER = '["amenity"="cafe"]'
# Walkable ways: every highway except motorways, minus foot=no and access=private.
WALKABLE_FILTER = (
    '["highway"]["highway"!~"^(motorway|motorway_link)$"]'
    '["foot"!="no"]["access"!="private"]'
)

# What the points are. `statement` is the Overpass selector (without the bbox),
# `r` the rule in metres (also the walking limit of the edges), `prefix` the id
# prefix. `story` is one line for the app, written into the fixture of the
# kinds that have one. The cafe kind has none: its fixture keeps its old shape.
KINDS = {
    "cafe": {
        "statement": f"nwr{CAFE_FILTER}",
        "r": 150,
        "prefix": "cafe",
        "singular": "cafe",
        "noun": "cafes",
        "story": None,
    },
    "bus_stop": {
        "statement": 'node["highway"="bus_stop"]',
        "r": 244,
        "prefix": "stop",
        "singular": "bus stop",
        "noun": "bus stops",
        "story": (
            "Keep as many bus stops as possible while no two are closer than 800 ft, "
            "the low end of San Francisco's stop spacing policy (800 to 1,360 ft)."
        ),
    },
    "bike_share": {
        "statement": 'nwr["amenity"="bicycle_rental"]',
        "r": 305,
        "prefix": "station",
        "singular": "bike-share station",
        "noun": "bike-share stations",
        "story": (
            "Keep as many bike-share stations as possible while no two are closer than "
            "1,000 ft, the station spacing NACTO recommends."
        ),
    },
}
SCRIPT_PATH = "scripts/fetch_place.py"
ATTRIBUTION = "© OpenStreetMap contributors"
LICENCE = "ODbL 1.0"
LICENCE_URL = "https://www.openstreetmap.org/copyright"
REPO_ROOT = Path(__file__).resolve().parent.parent
_NAME_RE = re.compile(r"^[a-z0-9_]+$")


def round_m(value: float) -> float:
    """Round metres to 0.1."""
    return round(value, 1)


# --- projection -----------------------------------------------------------

def centroid(latlons: list[tuple[float, float]]) -> tuple[float, float]:
    """Mean (lat, lon), rounded to 6 decimals so it can be stored and reused."""
    if not latlons:
        raise ValueError("cannot take the centroid of zero points")
    lat = sum(p[0] for p in latlons) / len(latlons)
    lon = sum(p[1] for p in latlons) / len(latlons)
    return round(lat, 6), round(lon, 6)


def project(lat: float, lon: float, origin: tuple[float, float]) -> tuple[float, float]:
    """Equirectangular projection around origin (lat, lon); metres rounded to 0.1."""
    lat0, lon0 = origin
    x = math.radians(lon - lon0) * math.cos(math.radians(lat0)) * EARTH_RADIUS_M
    y = math.radians(lat - lat0) * EARTH_RADIUS_M
    return round_m(x), round_m(y)


# --- points ---------------------------------------------------------------

def assign_point_ids(points: list[dict], prefix: str = "cafe") -> list[dict]:
    """Sort points by (OSM type, OSM id) and give them ids prefix000, prefix001, ...

    Each point is a dict with keys type, id, lat, lon and optional name.
    Returns new dicts with an added "point_id". The input is not modified.
    """
    ordered = sorted(points, key=lambda c: (c["type"], c["id"]))
    width = max(3, len(str(max(len(ordered) - 1, 0))))
    out = []
    for i, point in enumerate(ordered):
        item = dict(point)
        item["point_id"] = f"{prefix}{i:0{width}d}"
        out.append(item)
    return out


def assign_cafe_ids(cafes: list[dict]) -> list[dict]:
    """The cafe case of assign_point_ids: ids cafe000, cafe001, ... under "cafe_id"."""
    out = assign_point_ids(cafes, "cafe")
    for item in out:
        item["cafe_id"] = item.pop("point_id")
    return out


# --- bus stops: merge the two sides of a street ---------------------------

def _geo_dist_m(a: dict, b: dict) -> float:
    """Distance in metres between two lat/lon dicts (equirectangular, fine at 40 m)."""
    lat = math.radians((a["lat"] + b["lat"]) / 2)
    dx = math.radians(b["lon"] - a["lon"]) * math.cos(lat) * EARTH_RADIUS_M
    dy = math.radians(b["lat"] - a["lat"]) * EARTH_RADIUS_M
    return math.hypot(dx, dy)


def merge_stops(
    stops: list[dict], radius: float = MERGE_RADIUS_M
) -> tuple[list[dict], dict]:
    """Merge bus stops that share a name and lie within `radius` metres.

    Stops on both sides of a street are two directions of one stop. A group is
    merged only when every stop in it is within `radius` of every other (so a
    chain of stops cannot drift into one point). The merged point sits at the
    middle: the mean latitude and longitude. A stop with no name is never merged.
    The name is compared as written, after trimming spaces.

    Each stop is a dict with type, id, lat, lon and optional name. Returns
    (points, info). Points are dicts with type "node", id (the smallest merged
    OSM id), lat, lon, optional name and "osm_ids" (every merged OSM id, sorted).
    The result does not depend on the order of the input.
    """
    by_name: dict[str, list[dict]] = {}
    clusters: list[list[dict]] = []
    for s in sorted(stops, key=lambda s: (s["type"], s["id"])):
        name = (s.get("name") or "").strip()
        if name:
            by_name.setdefault(name, []).append(s)
        else:
            clusters.append([s])
    for name in sorted(by_name):
        groups = [[s] for s in by_name[name]]
        while True:
            best = None  # (largest distance inside the merged group, i, j)
            for i in range(len(groups)):
                for j in range(i + 1, len(groups)):
                    d = max(_geo_dist_m(a, b) for a in groups[i] for b in groups[j])
                    if d <= radius and (best is None or d < best[0] - 1e-9):
                        best = (d, i, j)
            if best is None:
                break
            _, i, j = best
            groups[i] = groups[i] + groups[j]
            del groups[j]
        clusters.extend(groups)

    points = []
    for members in clusters:
        ids = sorted(m["id"] for m in members)
        if len(members) == 1:
            lat, lon = members[0]["lat"], members[0]["lon"]
        else:
            lat = round(sum(m["lat"] for m in members) / len(members), 7)
            lon = round(sum(m["lon"] for m in members) / len(members), 7)
        point = {"type": "node", "id": ids[0], "lat": lat, "lon": lon, "osm_ids": ids}
        name = (members[0].get("name") or "").strip()
        if name:
            point["name"] = name
        points.append(point)
    points.sort(key=lambda p: p["id"])
    merged_points = sum(1 for p in points if len(p["osm_ids"]) > 1)
    info = {
        "radius_m": int(radius),
        "rule": (
            "stops with the same name, all within 40 m of each other, "
            "merged into one point at the mean of their latitude and longitude"
        ),
        "osm_stops": len(stops),
        "merged_points": merged_points,
        "stops_merged": len(stops) - len(points),
    }
    return points, info


# --- street graph ---------------------------------------------------------

def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def build_street_graph(
    node_xy: dict, ways: list[list]
) -> tuple[dict, list[tuple]]:
    """Street graph from projected nodes and ways.

    node_xy: OSM node id -> (x, y) metres. ways: lists of OSM node ids.
    A way node missing from node_xy ends the run; the way continues after it.
    Returns (adjacency, segments): adjacency maps node -> {neighbour: length};
    segments is the sorted list of unique undirected (a, b) pairs, a < b.
    """
    segs: set[tuple] = set()
    for way in ways:
        for a, b in zip(way, way[1:]):
            if a == b or a not in node_xy or b not in node_xy:
                continue
            segs.add((a, b) if a < b else (b, a))
    segments = sorted(segs)
    adj: dict = {}
    for a, b in segments:
        w = _dist(node_xy[a], node_xy[b])
        adj.setdefault(a, {})[b] = w
        adj.setdefault(b, {})[a] = w
    return adj, segments


def street_polylines(node_xy: dict, ways: list[list]) -> list[list[list[float]]]:
    """One polyline per way (runs of known nodes, at least two points), for drawing."""
    lines = []
    for way in ways:
        run: list[list[float]] = []
        for n in way:
            if n in node_xy:
                run.append([node_xy[n][0], node_xy[n][1]])
            else:
                if len(run) >= 2:
                    lines.append(run)
                run = []
        if len(run) >= 2:
            lines.append(run)
    return lines


# --- snapping -------------------------------------------------------------

def _project_on_segment(p, a, b) -> tuple[float, float]:
    """Return (t, distance) of the closest point to p on segment a-b, t in [0, 1]."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dy * dy
    t = 0.0 if len2 == 0 else ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
    t = max(0.0, min(1.0, t))
    q = (a[0] + t * dx, a[1] + t * dy)
    return t, _dist(p, q)


def snap_cafes(
    cafe_xy: list[tuple[float, float]],
    node_xy: dict,
    adj: dict,
    segments: list[tuple],
) -> tuple[dict, list, list[float]]:
    """Snap each cafe to its nearest street segment and add virtual nodes.

    Cafes snapping to the same segment are chained in order along it, so they
    connect directly. Returns (new_adj, snap_nodes, offsets): snap_nodes[i] is
    the graph node of cafe i and offsets[i] the cafe-to-street distance in
    metres. The input adjacency is not modified.
    """
    if cafe_xy and not segments:
        raise ValueError("no street segments to snap cafes to")

    per_segment: dict[tuple, list[tuple[float, int]]] = {}
    offsets: list[float] = []
    for i, p in enumerate(cafe_xy):
        best = None  # (distance, segment index, t)
        for k, (a, b) in enumerate(segments):
            t, d = _project_on_segment(p, node_xy[a], node_xy[b])
            if best is None or d < best[0] - _EPS:
                best = (d, k, t)
        d, k, t = best
        offsets.append(d)
        per_segment.setdefault(segments[k], []).append((t, i))

    new_adj = {n: dict(nb) for n, nb in adj.items()}
    snap_nodes: list = [None] * len(cafe_xy)
    for (a, b), items in per_segment.items():
        seg_len = _dist(node_xy[a], node_xy[b])
        items.sort()  # by t, then cafe index: deterministic
        # Replace the segment a-b with the chain a - s1 - s2 - ... - b.
        del new_adj[a][b]
        del new_adj[b][a]
        prev, prev_t = a, 0.0
        for t, i in items:
            node = ("snap", i)
            snap_nodes[i] = node
            w = (t - prev_t) * seg_len
            new_adj.setdefault(prev, {})[node] = w
            new_adj.setdefault(node, {})[prev] = w
            prev, prev_t = node, t
        w = (1.0 - prev_t) * seg_len
        new_adj[prev][b] = w
        new_adj[b][prev] = w
    return new_adj, snap_nodes, offsets


# --- shortest paths -------------------------------------------------------

def bounded_dijkstra(adj: dict, source, bound: float) -> dict:
    """Shortest path lengths from source to every node within bound metres."""
    if bound < 0:
        return {}
    dist = {source: 0.0}
    heap = [(0.0, 0, source)]
    counter = 1  # tie-breaker so nodes of mixed types never get compared
    done = set()
    while heap:
        d, _, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        for v, w in adj.get(u, {}).items():
            nd = d + w
            if nd <= bound + _EPS and nd < dist.get(v, math.inf):
                dist[v] = nd
                heapq.heappush(heap, (nd, counter, v))
                counter += 1
    return dist


def walking_edges(
    adj: dict, snap_nodes: list, offsets: list[float], limit: float = WALK_LIMIT_M
) -> list[tuple[int, int]]:
    """Index pairs (i, j), i < j, with offset_i + path + offset_j <= limit."""
    node_to_cafes: dict = {}
    for i, n in enumerate(snap_nodes):
        node_to_cafes.setdefault(n, []).append(i)
    edges = []
    for i, src in enumerate(snap_nodes):
        reach = bounded_dijkstra(adj, src, limit - offsets[i])
        for node, path in reach.items():
            for j in node_to_cafes.get(node, ()):
                if j > i and offsets[i] + path + offsets[j] <= limit + _EPS:
                    edges.append((i, j))
    edges.sort()
    return edges


# --- whole pipeline (pure) ------------------------------------------------

def build_place(
    cafes: list[dict],
    nodes: dict,
    ways: list[list],
    limit: float = WALK_LIMIT_M,
    prefix: str = "cafe",
) -> dict:
    """Compute the data part of a PlaceFixture from raw OSM-shaped input.

    cafes: the points (cafes, merged bus stops or stations): dicts with type,
    id, lat, lon, optional name and optional osm_ids (kept in the point).
    nodes: OSM node id -> (lat, lon). ways: lists of OSM node ids.
    limit: the walking limit in metres. prefix: the id prefix.
    Returns a dict with origin, points, streets, walking_edges and
    max_snap_m. Metadata (bbox, source, counts, dates) is added by the caller.
    """
    if not cafes:
        raise ValueError("no points")
    cafes = assign_point_ids(cafes, prefix)
    origin = centroid([(c["lat"], c["lon"]) for c in cafes])
    node_xy = {n: project(lat, lon, origin) for n, (lat, lon) in nodes.items()}

    adj, segments = build_street_graph(node_xy, ways)
    cafe_xy = [project(c["lat"], c["lon"], origin) for c in cafes]
    new_adj, snap_nodes, offsets = snap_cafes(cafe_xy, node_xy, adj, segments)
    pairs = walking_edges(new_adj, snap_nodes, offsets, limit)

    points = []
    for c, (x, y) in zip(cafes, cafe_xy):
        pt = {"id": c["point_id"], "x": x, "y": y, "lat": c["lat"], "lon": c["lon"]}
        if c.get("name"):
            pt["name"] = c["name"]
        if c.get("osm_ids"):
            pt["osm_ids"] = list(c["osm_ids"])
        points.append(pt)
    ids = [p["id"] for p in points]
    return {
        "origin": {"lat": origin[0], "lon": origin[1]},
        "points": points,
        "streets": street_polylines(node_xy, ways),
        "walking_edges": [[ids[i], ids[j]] for i, j in pairs],
        "max_snap_m": round_m(max(offsets)),
    }


# --- arguments ------------------------------------------------------------

def _parse_name(text: str) -> str:
    if not _NAME_RE.match(text):
        raise argparse.ArgumentTypeError(
            f"name {text!r} must use only lowercase letters, digits and underscore"
        )
    return text


def _parse_bbox(text: str) -> dict:
    parts = text.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            f"bbox must be four numbers south,west,north,east, got {len(parts)}"
        )
    try:
        south, west, north, east = (float(p) for p in parts)
    except ValueError:
        raise argparse.ArgumentTypeError(f"bbox {text!r} has a value that is not a number")
    if not all(math.isfinite(v) for v in (south, west, north, east)):
        raise argparse.ArgumentTypeError("bbox values must be finite numbers")
    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise argparse.ArgumentTypeError("latitude must be within -90 and 90")
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise argparse.ArgumentTypeError("longitude must be within -180 and 180")
    if not south < north:
        raise argparse.ArgumentTypeError("south must be smaller than north")
    if not west < east:
        raise argparse.ArgumentTypeError("west must be smaller than east")
    return {"south": south, "west": west, "north": north, "east": east}


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse and validate arguments. Exits with a plain message on bad input.

    Runs before any network call. Result: name, bbox (dict), kind, out (Path).
    """
    parser = argparse.ArgumentParser(
        prog="fetch_place.py",
        description="Fetch points (cafes, bus stops or bike-share stations) and streets "
        "from OpenStreetMap (Overpass) and write a Place fixture.",
    )
    parser.add_argument("name", type=_parse_name, help="place name, e.g. kadikoy")
    parser.add_argument("bbox", type=_parse_bbox, help="south,west,north,east")
    parser.add_argument(
        "--kind",
        choices=sorted(KINDS),
        default="cafe",
        help="what the points are (default: cafe)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output file (default: fixtures/place_<name>.json)",
    )
    parser.add_argument(
        "--endpoint",
        default=None,
        help="use only this Overpass endpoint URL (default: lz4.overpass-api.de, "
        "then overpass-api.de, then overpass.kumi.systems)",
    )
    args = parser.parse_args(argv)
    if args.endpoint is not None and not re.match(r"^https?://\S+$", args.endpoint):
        parser.error("--endpoint must be an http(s) URL")
    if args.out is None:
        args.out = REPO_ROOT / "fixtures" / f"place_{args.name}.json"
    return args


# --- Overpass -------------------------------------------------------------

def build_query(bbox: dict, kind: str = "cafe") -> str:
    """The exact Overpass query text. It is stored in the fixture.

    Only the first selector depends on the kind. The walkable ways are the same.
    """
    box = f"({bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']})"
    return (
        f"[out:json][timeout:{OVERPASS_TIMEOUT_S}];\n"
        f"{KINDS[kind]['statement']}{box};\n"
        "out center;\n"
        f"way{WALKABLE_FILTER}{box};\n"
        "out body;\n"
        ">;\n"
        "out skel qt;\n"
    )


def fetch_overpass(query: str, endpoint: str = OVERPASS_ENDPOINT) -> dict:
    """POST the query to Overpass and return the parsed JSON response."""
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"User-Agent": "AtomMap fetch_place.py (hackathon project)"},
    )
    with urllib.request.urlopen(request, timeout=OVERPASS_TIMEOUT_S + 30) as response:
        return json.loads(response.read().decode("utf-8"))


def _wanted(kind: str, el: dict, tags: dict) -> bool:
    """True when this element is a point of the kind."""
    if kind == "cafe":
        return tags.get("amenity") == "cafe"
    if kind == "bus_stop":
        return el["type"] == "node" and tags.get("highway") == "bus_stop"
    if kind == "bike_share":
        return tags.get("amenity") == "bicycle_rental"
    raise ValueError(f"unknown kind {kind!r}")


def parse_overpass(
    response: dict, kind: str = "cafe"
) -> tuple[list[dict], dict, list[list], str]:
    """Split an Overpass response into (points, nodes, ways, osm_data_timestamp).

    points: the elements of the kind, as dicts with type, id, lat, lon, optional
    name (for bus stops, before the merge). nodes: id -> (lat, lon).
    ways: lists of node ids, one per walkable way. Nothing is filtered or tuned.
    """
    try:
        timestamp = response["osm3s"]["timestamp_osm_base"]
        elements = response["elements"]
    except (KeyError, TypeError):
        raise ValueError("unexpected Overpass response: no osm3s timestamp or elements")
    cafes: list[dict] = []
    nodes: dict = {}
    ways: list[list] = []
    for el in elements:
        tags = el.get("tags") or {}
        if el["type"] == "node" and "lat" in el and "lon" in el:
            nodes[el["id"]] = (el["lat"], el["lon"])
        if _wanted(kind, el, tags):
            if "lat" in el and "lon" in el:
                lat, lon = el["lat"], el["lon"]
            elif "center" in el:
                lat, lon = el["center"]["lat"], el["center"]["lon"]
            else:
                raise ValueError(
                    f"{KINDS[kind]['singular']} {el['type']}/{el['id']} has no coordinates"
                )
            cafe = {"type": el["type"], "id": el["id"], "lat": lat, "lon": lon}
            if tags.get("name"):
                cafe["name"] = tags["name"]
            cafes.append(cafe)
        elif el["type"] == "way" and "nodes" in el and "highway" in tags:
            ways.append(list(el["nodes"]))
    return cafes, nodes, ways, timestamp


def fetch_with_retries(query: str, endpoints, fetch=fetch_overpass, sleep=time.sleep):
    """Try each endpoint in order, for RETRY_ROUNDS rounds with growing waits.

    Returns (response, endpoint_used). Raises the last error when all rounds fail.
    Only download errors are retried (OSError, which includes HTTP 502, and
    ValueError from a body that is not JSON).
    """
    last_err: Exception | None = None
    for round_no in range(1, RETRY_ROUNDS + 1):
        for endpoint in endpoints:
            print(
                f"Overpass: {endpoint}, attempt {round_no}/{RETRY_ROUNDS}",
                file=sys.stderr,
            )
            try:
                return fetch(query, endpoint), endpoint
            except (OSError, ValueError) as err:
                last_err = err
                print(f"  failed: {err}", file=sys.stderr)
        if round_no < RETRY_ROUNDS:
            wait = RETRY_WAITS_S[round_no - 1]
            print(f"  waiting {wait} s before the next round", file=sys.stderr)
            sleep(wait)
    assert last_err is not None
    raise last_err


# --- run ------------------------------------------------------------------

def run(
    argv: list[str],
    fetch=fetch_overpass,
    today: datetime.date | None = None,
    sleep=time.sleep,
) -> int:
    """Whole script. Returns the exit code (0 ok, 1 failed). Argument errors exit with 2.

    fetch(query, endpoint) -> dict can be replaced for offline tests.
    """
    args = parse_args(argv)  # exits before any network call on bad input
    kind = args.kind
    spec = KINDS[kind]
    query = build_query(args.bbox, kind)
    try:
        endpoints = (args.endpoint,) if args.endpoint else OVERPASS_ENDPOINTS
        response, endpoint_used = fetch_with_retries(query, endpoints, fetch, sleep)
        points, nodes, ways, timestamp = parse_overpass(response, kind)
    except (OSError, ValueError) as err:
        print(f"{args.name}: download failed: {err}", file=sys.stderr)
        return 1

    merge = None
    if kind == "bus_stop":
        points, merge = merge_stops(points)

    if len(points) < MIN_POINTS:
        extra = ""
        if merge is not None:
            extra = f" (after merging {merge['osm_stops']} OSM stops)"
        print(
            f"{args.name}: only {len(points)} {spec['noun']} found{extra}, "
            f"need at least {MIN_POINTS}. No file written.",
            file=sys.stderr,
        )
        return 1

    limit = float(spec["r"])
    try:
        place = build_place(points, nodes, ways, limit, spec["prefix"])
    except ValueError as err:
        print(f"{args.name}: could not build the place: {err}", file=sys.stderr)
        return 1

    # The cafe fixture keeps the shape it always had. The other kinds say what
    # they are and tell their story.
    fixture: dict = {"name": args.name, "mode": "place"}
    if spec["story"] is not None:
        fixture["kind"] = kind
        fixture["story"] = spec["story"]
    fixture.update(
        {
            "r": int(limit),
            "bbox": args.bbox,
            "origin": place["origin"],
            "points": place["points"],
            "streets": place["streets"],
            "walking_edges": place["walking_edges"],
        }
    )
    if merge is not None:
        fixture["merge"] = merge
    fixture["source"] = {
        "attribution": ATTRIBUTION,
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "overpass_endpoint": endpoint_used,
        "query": query,
        "osm_data_timestamp": timestamp,
        "fetched_at": (today or datetime.datetime.now(datetime.timezone.utc).date()).isoformat(),
        "script": SCRIPT_PATH,
        "script_args": list(argv),
    }
    fixture["counts"] = {
        "points": len(place["points"]),
        "street_polylines": len(place["streets"]),
        "walking_edges": len(place["walking_edges"]),
        "max_snap_m": place["max_snap_m"],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    merged = ""
    if merge is not None:
        merged = f", {merge['stops_merged']} stops merged into {merge['merged_points']} points"
    print(
        f"{args.name}: wrote {args.out} ({fixture['counts']['points']} {spec['noun']}, "
        f"{fixture['counts']['walking_edges']} walking edges{merged})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))