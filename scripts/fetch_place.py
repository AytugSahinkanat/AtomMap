"""Build a Place fixture (cafes + walking edges on real streets).

Run by hand, once per place (a bbox that starts with a minus sign needs `--`
before it, for example `fetch_place.py name -- -33.9,18.4,-33.8,18.5`):

    python scripts/fetch_place.py kadikoy 40.982,29.020,40.996,29.040
    python scripts/fetch_place.py midtown 40.750,-73.995,40.762,-73.975

One Overpass request, then the pure functions below, then one JSON file.
Standard library only. The fetch function is a parameter of `run`, so tests
can replace it and never touch the network.

Coordinates: local metres, x east and y north of the cafe centroid, rounded
to 0.1 m (equirectangular projection).
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

# Minimum cafe count. It only catches a broken or empty download. It is not
# a quality bar: any count of 20 or more is accepted and stored as it is.
MIN_CAFES = 20

OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"
# Tried in this order in every round. --endpoint forces a single one.
OVERPASS_ENDPOINTS = (
    OVERPASS_ENDPOINT,
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


# --- cafes ----------------------------------------------------------------

def assign_cafe_ids(cafes: list[dict]) -> list[dict]:
    """Sort cafes by (OSM type, OSM id) and give them ids cafe000, cafe001, ...

    Each cafe is a dict with keys type, id, lat, lon and optional name.
    Returns new dicts with an added "cafe_id". The input is not modified.
    """
    ordered = sorted(cafes, key=lambda c: (c["type"], c["id"]))
    width = max(3, len(str(max(len(ordered) - 1, 0))))
    out = []
    for i, cafe in enumerate(ordered):
        item = dict(cafe)
        item["cafe_id"] = f"cafe{i:0{width}d}"
        out.append(item)
    return out


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
) -> dict:
    """Compute the data part of a PlaceFixture from raw OSM-shaped input.

    cafes: dicts with type, id, lat, lon and optional name.
    nodes: OSM node id -> (lat, lon). ways: lists of OSM node ids.
    Returns a dict with origin, points, streets, walking_edges and
    max_snap_m. Metadata (bbox, source, counts, dates) is added by the caller.
    """
    if not cafes:
        raise ValueError("no cafes")
    cafes = assign_cafe_ids(cafes)
    origin = centroid([(c["lat"], c["lon"]) for c in cafes])
    node_xy = {n: project(lat, lon, origin) for n, (lat, lon) in nodes.items()}

    adj, segments = build_street_graph(node_xy, ways)
    cafe_xy = [project(c["lat"], c["lon"], origin) for c in cafes]
    new_adj, snap_nodes, offsets = snap_cafes(cafe_xy, node_xy, adj, segments)
    pairs = walking_edges(new_adj, snap_nodes, offsets, limit)

    points = []
    for c, (x, y) in zip(cafes, cafe_xy):
        pt = {"id": c["cafe_id"], "x": x, "y": y, "lat": c["lat"], "lon": c["lon"]}
        if c.get("name"):
            pt["name"] = c["name"]
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

    Runs before any network call. Result: name, bbox (dict), out (Path).
    """
    parser = argparse.ArgumentParser(
        prog="fetch_place.py",
        description="Fetch cafes and streets from OpenStreetMap (Overpass) "
        "and write a Place fixture.",
    )
    parser.add_argument("name", type=_parse_name, help="place name, e.g. kadikoy")
    parser.add_argument("bbox", type=_parse_bbox, help="south,west,north,east")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output file (default: fixtures/place_<name>.json)",
    )
    parser.add_argument(
        "--endpoint",
        default=None,
        help="use only this Overpass endpoint URL (default: overpass-api.de, "
        "then overpass.kumi.systems)",
    )
    args = parser.parse_args(argv)
    if args.endpoint is not None and not re.match(r"^https?://\S+$", args.endpoint):
        parser.error("--endpoint must be an http(s) URL")
    if args.out is None:
        args.out = REPO_ROOT / "fixtures" / f"place_{args.name}.json"
    return args


# --- Overpass -------------------------------------------------------------

def build_query(bbox: dict) -> str:
    """The exact Overpass query text. It is stored in the fixture."""
    box = f"({bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']})"
    return (
        f"[out:json][timeout:{OVERPASS_TIMEOUT_S}];\n"
        f"nwr{CAFE_FILTER}{box};\n"
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


def parse_overpass(response: dict) -> tuple[list[dict], dict, list[list], str]:
    """Split an Overpass response into (cafes, nodes, ways, osm_data_timestamp).

    cafes: dicts with type, id, lat, lon, optional name. nodes: id -> (lat, lon).
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
        if tags.get("amenity") == "cafe":
            if "lat" in el and "lon" in el:
                lat, lon = el["lat"], el["lon"]
            elif "center" in el:
                lat, lon = el["center"]["lat"], el["center"]["lon"]
            else:
                raise ValueError(f"cafe {el['type']}/{el['id']} has no coordinates")
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
    query = build_query(args.bbox)
    try:
        endpoints = (args.endpoint,) if args.endpoint else OVERPASS_ENDPOINTS
        response, endpoint_used = fetch_with_retries(query, endpoints, fetch, sleep)
        cafes, nodes, ways, timestamp = parse_overpass(response)
    except (OSError, ValueError) as err:
        print(f"{args.name}: download failed: {err}", file=sys.stderr)
        return 1

    if len(cafes) < MIN_CAFES:
        print(
            f"{args.name}: only {len(cafes)} cafes found, need at least {MIN_CAFES}. "
            "No file written.",
            file=sys.stderr,
        )
        return 1

    try:
        place = build_place(cafes, nodes, ways)
    except ValueError as err:
        print(f"{args.name}: could not build the place: {err}", file=sys.stderr)
        return 1

    fixture = {
        "name": args.name,
        "mode": "place",
        "r": int(WALK_LIMIT_M),
        "bbox": args.bbox,
        "origin": place["origin"],
        "points": place["points"],
        "streets": place["streets"],
        "walking_edges": place["walking_edges"],
        "source": {
            "attribution": ATTRIBUTION,
            "licence": LICENCE,
            "licence_url": LICENCE_URL,
            "overpass_endpoint": endpoint_used,
            "query": query,
            "osm_data_timestamp": timestamp,
            "fetched_at": (today or datetime.datetime.now(datetime.timezone.utc).date()).isoformat(),
            "script": SCRIPT_PATH,
            "script_args": list(argv),
        },
        "counts": {
            "points": len(place["points"]),
            "street_polylines": len(place["streets"]),
            "walking_edges": len(place["walking_edges"]),
            "max_snap_m": place["max_snap_m"],
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"{args.name}: wrote {args.out} ({fixture['counts']['points']} cafes, "
        f"{fixture['counts']['walking_edges']} walking edges)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
