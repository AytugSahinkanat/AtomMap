"""Offline tests for scripts/fetch_place.py: the kinds (cafe, bus_stop, bike_share),
their Overpass filters and the bus stop merge. No network: `run` gets a fake fetch.

Run from the repository root (pytest comes with the engine test extras):

    engine/.venv/Scripts/python -m pytest scripts/test_fetch_place.py -q      (Windows)
    engine/.venv/bin/python -m pytest scripts/test_fetch_place.py -q          (macOS, Linux)
"""

from __future__ import annotations

import datetime
import json
import math
import random
import re
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import fetch_place as fp  # noqa: E402

REPO = SCRIPTS.parent
DAY = datetime.date(2026, 11, 25)
TIMESTAMP = "2026-11-25T00:00:00Z"

# One long east-west street. Points sit at the street nodes, 0.0011 degrees of
# longitude apart: about 96.7 m at this latitude.
LAT0 = 37.76
LON0 = -122.41
LON_STEP = 0.0011
STEP_M = math.radians(LON_STEP) * math.cos(math.radians(LAT0)) * fp.EARTH_RADIUS_M
BBOX_ARGS = "37.755,-122.425,37.770,-122.405"


def lon_of(k: int) -> float:
    return round(LON0 + k * LON_STEP, 7)


def street_elements(n_nodes: int) -> list[dict]:
    """Street nodes (ids 1..n) and one residential way through them."""
    nodes = [
        {"type": "node", "id": k + 1, "lat": LAT0, "lon": lon_of(k)} for k in range(n_nodes)
    ]
    way = {
        "type": "way",
        "id": 500,
        "nodes": [k + 1 for k in range(n_nodes)],
        "tags": {"highway": "residential"},
    }
    return nodes + [way]


def response(elements: list[dict]) -> dict:
    return {"osm3s": {"timestamp_osm_base": TIMESTAMP}, "elements": elements}


def run_script(argv: list[str], elements: list[dict], tmp_path: Path, name: str = "testplace"):
    """Run the whole script on a fake fetch. Returns (exit code, fixture dict or None, queries)."""
    out = tmp_path / f"{name}.json"
    queries: list[str] = []

    def fake_fetch(query: str, endpoint: str) -> dict:
        queries.append(query)
        return response(elements)

    code = fp.run([name, BBOX_ARGS, *argv, "--out", str(out)], fetch=fake_fetch, today=DAY)
    fixture = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    return code, fixture, queries


def bus_stop_elements(pairs: int = 25) -> list[dict]:
    """`pairs` stops, each on both sides of the street (22 m apart), same name per pair."""
    out = []
    for k in range(pairs):
        for side, (osm_id, dlat) in enumerate(((10_000 + 2 * k, 0.0001), (10_001 + 2 * k, -0.0001))):
            out.append(
                {
                    "type": "node",
                    "id": osm_id,
                    "lat": round(LAT0 + dlat, 7),
                    "lon": lon_of(k),
                    "tags": {"highway": "bus_stop", "name": f"Stop {k}"},
                }
            )
    return out


def station_elements(count: int = 25) -> list[dict]:
    """`count` stations 3.3 m off the street: some nodes, some areas with a centre point."""
    out = []
    for k in range(count):
        tags = {"amenity": "bicycle_rental", "name": f"Station {k}"}
        lat = round(LAT0 + 0.00003, 7)
        if k % 5 == 4:
            out.append({"type": "way", "id": 30_000 + k, "center": {"lat": lat, "lon": lon_of(k)}, "tags": tags})
        else:
            out.append({"type": "node", "id": 20_000 + k, "lat": lat, "lon": lon_of(k), "tags": tags})
    return out


def cafe_elements(count: int = 25) -> list[dict]:
    out = []
    for k in range(count):
        out.append(
            {
                "type": "node",
                "id": 40_000 + k,
                "lat": round(LAT0 + 0.00003, 7),
                "lon": lon_of(k),
                "tags": {"amenity": "cafe", "name": f"Cafe {k}"},
            }
        )
    return out


def noise() -> list[dict]:
    """Elements of the other kinds. A kind must ignore all of them."""
    return [
        {"type": "node", "id": 90_001, "lat": LAT0, "lon": lon_of(3), "tags": {"amenity": "cafe", "name": "C"}},
        {"type": "node", "id": 90_002, "lat": LAT0, "lon": lon_of(4), "tags": {"highway": "bus_stop", "name": "B"}},
        {"type": "node", "id": 90_003, "lat": LAT0, "lon": lon_of(5), "tags": {"amenity": "bicycle_rental"}},
        {"type": "node", "id": 90_004, "lat": LAT0, "lon": lon_of(6), "tags": {"amenity": "bicycle_parking"}},
        {"type": "node", "id": 90_005, "lat": LAT0, "lon": lon_of(7), "tags": {"public_transport": "platform"}},
    ]


# ---------------------------------------------------------------- queries


def test_cafe_query_is_the_one_the_kadikoy_fixture_was_made_with():
    fixture = REPO / "fixtures" / "place_kadikoy.json"
    if not fixture.exists():
        pytest.skip("fixtures/place_kadikoy.json is missing")
    stored = json.loads(fixture.read_text(encoding="utf-8"))
    assert fp.build_query(stored["bbox"]) == stored["source"]["query"]
    assert fp.build_query(stored["bbox"], "cafe") == stored["source"]["query"]


def test_each_kind_has_its_own_first_selector_and_the_same_streets():
    bbox = {"south": 1.0, "west": 2.0, "north": 3.0, "east": 4.0}
    box = "(1.0,2.0,3.0,4.0)"
    cafe = fp.build_query(bbox, "cafe")
    stop = fp.build_query(bbox, "bus_stop")
    bike = fp.build_query(bbox, "bike_share")
    assert f'nwr["amenity"="cafe"]{box};' in cafe
    assert f'node["highway"="bus_stop"]{box};' in stop
    assert f'nwr["amenity"="bicycle_rental"]{box};' in bike
    # Nothing of another kind in a query.
    assert "bus_stop" not in cafe and "bicycle_rental" not in cafe
    assert "cafe" not in stop and "bicycle_rental" not in stop
    assert "cafe" not in bike and "bus_stop" not in bike
    # Everything after the first selector is the same: streets stay as they are.
    tail = lambda q: q.split(";\n", 2)[2]  # noqa: E731
    assert tail(cafe) == tail(stop) == tail(bike)
    assert f"way{fp.WALKABLE_FILTER}{box};" in tail(bike)


# ---------------------------------------------------------------- filters


def test_parse_overpass_takes_only_the_points_of_the_kind():
    resp = response(street_elements(8) + cafe_elements(3) + bus_stop_elements(2) + station_elements(2) + noise())
    cafes = fp.parse_overpass(resp, "cafe")[0]
    stops = fp.parse_overpass(resp, "bus_stop")[0]
    bikes = fp.parse_overpass(resp, "bike_share")[0]
    assert {c["id"] for c in cafes} == {40_000, 40_001, 40_002, 90_001}
    assert {s["id"] for s in stops} == {10_000, 10_001, 10_002, 10_003, 90_002}
    assert {b["id"] for b in bikes} == {20_000, 20_001, 90_003}
    # Default kind is cafe.
    assert fp.parse_overpass(resp)[0] == cafes


def test_bus_stops_are_nodes_only_and_the_street_ways_are_not_stops():
    way_stop = {"type": "way", "id": 77, "nodes": [1, 2], "center": {"lat": LAT0, "lon": LON0}, "tags": {"highway": "bus_stop"}}
    resp = response(street_elements(4) + bus_stop_elements(1) + [way_stop])
    stops, nodes, ways, ts = fp.parse_overpass(resp, "bus_stop")
    assert {s["id"] for s in stops} == {10_000, 10_001}
    assert ts == TIMESTAMP
    assert len(ways) == 2  # the street and the odd way are both read as ways, and neither is a stop
    assert nodes[1] == (LAT0, lon_of(0))


def test_bike_share_takes_areas_through_their_centre():
    stations = fp.parse_overpass(response(station_elements(5)), "bike_share")[0]
    areas = [s for s in stations if s["type"] == "way"]
    assert len(areas) == 1 and areas[0]["lon"] == lon_of(4)
    assert all("name" in s for s in stations)


def test_a_point_without_coordinates_is_a_plain_error_naming_the_kind():
    bad = {"type": "way", "id": 5, "tags": {"amenity": "bicycle_rental"}}
    with pytest.raises(ValueError, match="bike-share station way/5 has no coordinates"):
        fp.parse_overpass(response([bad]), "bike_share")
    bad_cafe = {"type": "way", "id": 6, "tags": {"amenity": "cafe"}}
    with pytest.raises(ValueError, match="cafe way/6 has no coordinates"):
        fp.parse_overpass(response([bad_cafe]), "cafe")


# ---------------------------------------------------------------- merge


def stop(osm_id: int, lat: float, lon: float, name: str | None = "Main & 1st") -> dict:
    s = {"type": "node", "id": osm_id, "lat": lat, "lon": lon}
    if name is not None:
        s["name"] = name
    return s


def metres_north(m: float) -> float:
    """Degrees of latitude for m metres."""
    return math.degrees(m / fp.EARTH_RADIUS_M)


def test_two_stops_with_the_same_name_within_40_m_become_one_point_at_their_middle():
    a = stop(7, 37.7600000, -122.4100000)
    b = stop(3, 37.7600000 + metres_north(20), -122.4100000 + 0.00004)
    points, info = fp.merge_stops([a, b])
    assert len(points) == 1
    p = points[0]
    assert p["id"] == 3 and p["osm_ids"] == [3, 7] and p["name"] == "Main & 1st" and p["type"] == "node"
    assert p["lat"] == round((a["lat"] + b["lat"]) / 2, 7)
    assert p["lon"] == round((a["lon"] + b["lon"]) / 2, 7)
    assert info["osm_stops"] == 2 and info["merged_points"] == 1 and info["stops_merged"] == 1
    assert info["radius_m"] == 40


def test_the_distance_rule_is_40_m():
    base = stop(1, 37.76, -122.41)
    near = stop(2, 37.76 + metres_north(39.5), -122.41)
    far = stop(3, 37.76 + metres_north(40.5), -122.41)
    assert len(fp.merge_stops([base, near])[0]) == 1
    assert len(fp.merge_stops([base, far])[0]) == 2


def test_different_names_and_missing_names_are_never_merged():
    near = lambda k, name: stop(k, 37.76 + metres_north(5 * k), -122.41, name)  # noqa: E731
    points, info = fp.merge_stops([near(1, "Main & 1st"), near(2, "Main & 2nd")])
    assert len(points) == 2 and info["stops_merged"] == 0
    points, _ = fp.merge_stops([near(1, None), near(2, None)])
    assert len(points) == 2 and all("name" not in p for p in points)
    points, _ = fp.merge_stops([near(1, "   "), near(2, "")])
    assert len(points) == 2
    # The name is compared as written (spaces trimmed), not changed to lower case.
    points, _ = fp.merge_stops([near(1, "Main & 1st"), near(2, "main & 1st")])
    assert len(points) == 2
    points, _ = fp.merge_stops([near(1, "Main & 1st "), near(2, " Main & 1st")])
    assert len(points) == 1


def test_a_chain_does_not_drift_into_one_point():
    # A-B 30 m, B-C 30 m, A-C 60 m, all the same name. All of a group must be within 40 m of each other.
    a = stop(1, 37.76, -122.41)
    b = stop(2, 37.76 + metres_north(30), -122.41)
    c = stop(3, 37.76 + metres_north(60), -122.41)
    points, info = fp.merge_stops([a, b, c])
    assert sorted(p["osm_ids"] for p in points) == [[1, 2], [3]]
    assert info["merged_points"] == 1 and info["stops_merged"] == 1


def test_four_stops_around_one_crossing_are_one_point_at_the_mean():
    lat, lon = 37.76, -122.41
    d = metres_north(12)
    stops = [stop(4, lat + d, lon), stop(2, lat - d, lon), stop(9, lat, lon + 0.00012), stop(1, lat, lon - 0.00012)]
    points, info = fp.merge_stops(stops)
    assert len(points) == 1 and points[0]["osm_ids"] == [1, 2, 4, 9] and points[0]["id"] == 1
    assert points[0]["lat"] == round(sum(s["lat"] for s in stops) / 4, 7)
    assert info["stops_merged"] == 3


def test_the_merge_does_not_depend_on_the_order_of_the_input():
    rng = random.Random(7)
    stops = []
    for k in range(30):
        base = 37.76 + metres_north(25 * (k // 2) * 3)
        stops.append(stop(100 + k, base + metres_north(8 * (k % 2)), -122.41 + 0.00001 * (k % 3), f"S{k // 2}"))
    expected = fp.merge_stops(stops)
    for _ in range(5):
        shuffled = stops[:]
        rng.shuffle(shuffled)
        assert fp.merge_stops(shuffled) == expected


def test_an_unmerged_stop_keeps_its_own_coordinates_and_its_osm_id():
    points, info = fp.merge_stops([stop(5, 37.7612345, -122.4112345, "Alone")])
    assert points == [{"type": "node", "id": 5, "lat": 37.7612345, "lon": -122.4112345, "osm_ids": [5], "name": "Alone"}]
    assert info["stops_merged"] == 0 and info["merged_points"] == 0


# ---------------------------------------------------------------- bus stop fixture


def test_bus_stop_fixture(tmp_path):
    elements = street_elements(25) + bus_stop_elements(25) + noise()
    code, fx, queries = run_script(["--kind", "bus_stop"], elements, tmp_path)
    assert code == 0 and fx is not None
    assert "node[\"highway\"=\"bus_stop\"]" in queries[0]
    assert list(fx) == [
        "name", "mode", "kind", "story", "r", "bbox", "origin", "points", "streets",
        "walking_edges", "merge", "source", "counts",
    ]
    assert fx["kind"] == "bus_stop" and fx["mode"] == "place" and fx["r"] == 244
    assert fx["story"] == (
        "Keep as many bus stops as possible while no two are closer than 800 ft, "
        "the low end of San Francisco's stop spacing policy (800 to 1,360 ft)."
    )
    # 25 pairs of stops, plus one stray stop from the noise elements that has the name "B" and is alone.
    assert fx["merge"]["osm_stops"] == 51
    assert fx["merge"]["merged_points"] == 25
    assert fx["merge"]["stops_merged"] == 25
    assert fx["merge"]["radius_m"] == 40
    assert fx["counts"]["points"] == 26
    # The merged osm ids are kept, and ids run in the order of the smallest osm id.
    pts = fx["points"]
    assert [p["id"] for p in pts] == [f"stop{i:03d}" for i in range(26)]
    assert pts[0]["osm_ids"] == [10_000, 10_001] and pts[0]["name"] == "Stop 0"
    assert pts[24]["osm_ids"] == [10_048, 10_049]
    assert pts[25]["osm_ids"] == [90_002]
    # A merged point is at the middle of its two stops: on the street.
    assert abs(pts[0]["lat"] - LAT0) < 1e-6 and pts[0]["lon"] == lon_of(0)
    assert "--kind" in fx["source"]["script_args"] and "bus_stop" in fx["source"]["script_args"]
    assert fx["source"]["query"] == queries[0]
    assert fx["source"]["attribution"] == "© OpenStreetMap contributors"


def test_bus_stop_walking_edges_use_the_244_m_rule_on_the_streets(tmp_path):
    n = 25
    code, fx, _ = run_script(["--kind", "bus_stop"], street_elements(n) + bus_stop_elements(n), tmp_path)
    assert code == 0
    assert STEP_M * 2 < 244 < STEP_M * 3  # two steps are a walk of 193 m, three are 290 m
    ids = [p["id"] for p in fx["points"]]
    expected = {(ids[i], ids[i + d]) for d in (1, 2) for i in range(n - d)}
    got = {tuple(e) for e in fx["walking_edges"]}
    assert got == expected and len(fx["walking_edges"]) == len(expected) == 47
    assert fx["counts"]["walking_edges"] == 47 and fx["counts"]["street_polylines"] == 1


def test_bus_stops_that_merge_below_20_points_write_no_file(tmp_path, capsys):
    # 15 pairs: 30 OSM stops, but only 15 points.
    code, fx, _ = run_script(["--kind", "bus_stop"], street_elements(15) + bus_stop_elements(15), tmp_path)
    assert code == 1 and fx is None
    err = capsys.readouterr().err
    assert "only 15 bus stops found (after merging 30 OSM stops), need at least 20. No file written." in err


# ---------------------------------------------------------------- bike share fixture


def test_bike_share_fixture(tmp_path):
    n = 25
    code, fx, queries = run_script(["--kind", "bike_share"], street_elements(n) + station_elements(n) + noise(), tmp_path)
    assert code == 0 and fx is not None
    assert "nwr[\"amenity\"=\"bicycle_rental\"]" in queries[0]
    assert list(fx) == [
        "name", "mode", "kind", "story", "r", "bbox", "origin", "points", "streets",
        "walking_edges", "source", "counts",
    ]
    assert "merge" not in fx
    assert fx["kind"] == "bike_share" and fx["r"] == 305
    assert fx["story"] == (
        "Keep as many bike-share stations as possible while no two are closer than "
        "1,000 ft, the station spacing NACTO recommends."
    )
    # 25 stations and one stray rental node from the noise elements.
    assert fx["counts"]["points"] == 26
    assert all(p["id"].startswith("station") for p in fx["points"])
    assert "osm_ids" not in fx["points"][0]
    assert fx["source"]["query"] == queries[0]


def test_bike_share_walking_edges_use_the_305_m_rule(tmp_path):
    n = 25
    code, fx, _ = run_script(["--kind", "bike_share"], street_elements(n) + station_elements(n), tmp_path)
    assert code == 0
    # Three steps are 290 m plus two walks of 3.3 m to the street: 297 m, inside 305 m. Four steps are not.
    assert STEP_M * 3 + 6.7 < 305 < STEP_M * 4
    # Station ids follow (type, osm id): nodes 20000+ come before ways 30000+, so look up by name.
    by_name = {p["name"]: p["id"] for p in fx["points"]}
    expected = {
        tuple(sorted((by_name[f"Station {i}"], by_name[f"Station {i + d}"])))
        for d in (1, 2, 3)
        for i in range(n - d)
    }
    got = {tuple(sorted(e)) for e in fx["walking_edges"]}
    assert got == expected and len(expected) == 24 + 23 + 22


def test_bike_share_below_20_writes_no_file(tmp_path, capsys):
    code, fx, _ = run_script(["--kind", "bike_share"], street_elements(10) + station_elements(10), tmp_path)
    assert code == 1 and fx is None
    assert "only 10 bike-share stations found, need at least 20. No file written." in capsys.readouterr().err


# ---------------------------------------------------------------- cafe stays as it was


def test_the_default_kind_is_cafe_and_its_fixture_keeps_the_old_shape(tmp_path):
    n = 25
    elements = street_elements(n) + cafe_elements(n) + noise()
    code, fx, queries = run_script([], elements, tmp_path)
    code_k, fx_k, _ = run_script(["--kind", "cafe"], elements, tmp_path, name="testplace_k")
    assert code == code_k == 0
    assert list(fx) == ["name", "mode", "r", "bbox", "origin", "points", "streets", "walking_edges", "source", "counts"]
    assert "kind" not in fx and "story" not in fx and "merge" not in fx
    assert fx["r"] == 150 and fx["counts"]["points"] == 26
    assert [p["id"] for p in fx["points"]] == [f"cafe{i:03d}" for i in range(26)]
    assert all("osm_ids" not in p for p in fx["points"])
    assert 'nwr["amenity"="cafe"]' in queries[0]
    # --kind cafe is the same as no --kind, except for what the script records about its own arguments.
    for key in ("points", "streets", "walking_edges", "counts", "r", "origin"):
        assert fx[key] == fx_k[key]


def test_cafe_below_20_keeps_its_old_message(tmp_path, capsys):
    code, fx, _ = run_script([], street_elements(10) + cafe_elements(5), tmp_path)
    assert code == 1 and fx is None
    assert "testplace: only 5 cafes found, need at least 20. No file written." in capsys.readouterr().err


# ---------------------------------------------------------------- arguments


def test_kind_argument(capsys):
    assert fp.parse_args(["x", BBOX_ARGS]).kind == "cafe"
    assert fp.parse_args(["x", BBOX_ARGS, "--kind", "bus_stop"]).kind == "bus_stop"
    assert fp.parse_args(["x", BBOX_ARGS, "--kind", "bike_share"]).kind == "bike_share"
    with pytest.raises(SystemExit) as e:
        fp.parse_args(["x", BBOX_ARGS, "--kind", "pharmacy"])
    assert e.value.code == 2
    assert "invalid choice" in capsys.readouterr().err


def test_a_bad_kind_makes_no_request():
    calls = []
    with pytest.raises(SystemExit):
        fp.run(["x", BBOX_ARGS, "--kind", "nope"], fetch=lambda q, e: calls.append(q))
    assert calls == []


def test_the_two_commands_for_the_us_maps_parse():
    sf = fp.parse_args(
        ["sf_bus_stops", "37.755,-122.425,37.770,-122.405", "--kind", "bus_stop", "--out", "fixtures/place_sf_bus_stops.json"]
    )
    assert sf.bbox == {"south": 37.755, "west": -122.425, "north": 37.770, "east": -122.405}
    assert sf.out == Path("fixtures/place_sf_bus_stops.json")
    nyc = fp.parse_args(
        ["nyc_bike_share", "40.720,-74.005,40.735,-73.985", "--kind", "bike_share", "--out", "fixtures/place_nyc_bike_share.json"]
    )
    assert nyc.bbox == {"south": 40.72, "west": -74.005, "north": 40.735, "east": -73.985}
    # Without --out the default file is the one the names ask for.
    assert fp.parse_args(["sf_bus_stops", "37.755,-122.425,37.770,-122.405"]).out == REPO / "fixtures" / "place_sf_bus_stops.json"
    assert fp.parse_args(["nyc_bike_share", "40.720,-74.005,40.735,-73.985"]).out == REPO / "fixtures" / "place_nyc_bike_share.json"


# ---------------------------------------------------------------- words


# Operator and brand names of the two US systems. The project writes none of them. They are
# spelled in pieces here so that the repository does not contain them in plain text either.
_BRAND_PIECES = [
    ("ci", "ti ?", "bi", "ke"),
    ("mu", "ni"),
    ("sf", "mta"),
    ("ly", "ft"),
    ("ba", "rt"),
    ("moti", "vate"),
    ("bay ?", "whe", "els"),
    ("ford ?go", " ?bike"),
]
BRANDS = re.compile(r"\b(" + "|".join("".join(p) for p in _BRAND_PIECES) + r")\b", re.IGNORECASE)


def test_no_brand_names_in_the_kinds_or_in_the_script():
    for kind, spec in fp.KINDS.items():
        for key in ("story", "singular", "noun", "prefix"):
            text = spec[key] or ""
            assert not BRANDS.search(text), (kind, key, text)
    source = (SCRIPTS / "fetch_place.py").read_text(encoding="utf-8")
    assert not BRANDS.search(source)


def test_the_story_lines_say_what_the_rule_is():
    assert fp.KINDS["bus_stop"]["r"] == 244 and "800 ft" in fp.KINDS["bus_stop"]["story"]
    assert fp.KINDS["bike_share"]["r"] == 305 and "1,000 ft" in fp.KINDS["bike_share"]["story"]
    assert 244 == round(800 * 0.3048) and 305 == round(1000 * 0.3048)
    assert fp.KINDS["cafe"]["r"] == 150 and fp.KINDS["cafe"]["story"] is None
