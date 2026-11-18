import json

import pytest

from atommap.settings import SettingsError, load_settings


def test_committed_settings_load(settings):
    assert settings["map_sizes"]["hero_points"] == 70
    assert settings["run_counts"]["hypothesis_examples"] >= 100
    assert settings["run_counts"]["slow_hypothesis_examples"] <= 20


def test_missing_value_aborts_and_names_it(tmp_path):
    data = load_settings()
    del data["seeds"]["hero"]
    bad = tmp_path / "s.json"
    bad.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(SettingsError, match=r"seeds\.hero"):
        load_settings(bad)


def test_missing_file_aborts(tmp_path):
    with pytest.raises(SettingsError):
        load_settings(tmp_path / "nope.json")
