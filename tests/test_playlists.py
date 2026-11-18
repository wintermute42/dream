"""Playlists (playlists.py): scenes, the editor text, the owner's own file, names of earlier versions, AI playlists."""
import json
import os
import random

import playlists

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_shipped_playlists_are_valid():
    shipped = playlists.read_file(os.path.join(ROOT, "playlists.json"))
    assert shipped
    for name, entry in shipped.items():
        scenes, journey, fade = playlists.playlist(entry)
        assert scenes, name
        assert 0 <= fade <= 30


def test_scene_clamps_and_cleans():
    s = playlists.scene({"prompt": "  a red moon  ", "strength": 5, "zoom": "x", "fx": "tunnel+nope+tunnel",
                         "style": "aquarell", "style_ref": "0123456789AB", "pattern": "Puls", "secs": 1})
    assert s == {"prompt": "a red moon", "settings": {"strength": 0.95, "fx": "tunnel", "style": "watercolour",
                                                       "style_ref": "0123456789ab"}, "pattern": "Pulse", "secs": 5}
    assert playlists.scene({"prompt": "  "}) is None
    assert playlists.scene(42) is None
    assert playlists.scene("just a prompt")["prompt"] == "just a prompt"
    assert playlists.scene({"prompt": "p", "style": "off", "fx": "off"})["settings"] == {"style": "", "fx": ""}


def test_text_round_trip():
    entry = {"journey": True, "fade": 5, "scenes": [{"prompt": "a forest", "strength": 0.6, "pattern": "Flow", "secs": 40},
                                                    "a lake", {"prompt": "fire", "fx": "waves", "style": "off"}]}
    text = playlists.to_text(entry)
    assert text.splitlines()[0] == "# Journey fade=5"
    back = playlists.from_text(text)
    assert playlists.playlist(back) == playlists.playlist(entry)


def test_from_text_ignores_junk():
    assert playlists.from_text("\n\n# a comment\n | strength=0.5\n") == []
    assert playlists.from_text("# Reise\nsea") == {"journey": True, "scenes": ["sea"]}   # OLD_ name of "# Journey"
    assert len(playlists.from_text("\n".join(f"scene {i}" for i in range(500)))) == 200


def test_new_name():
    assert playlists.new_name("Feuer") == "Fire"                  # OLD_NAMES of earlier versions
    assert playlists.new_name("KI: ocean") == playlists.AI_PREFIX + "ocean"
    assert playlists.new_name("My own") == "My own"


def test_clean_name():
    assert playlists.clean_name("  a\x00b\nc  ") == "abc"
    assert playlists.clean_name(playlists.SURPRISE) == ""
    assert len(playlists.clean_name("x" * 100)) == 60


def test_own_file_wins_and_is_removed_again(sandbox):
    assert playlists.USER_FILE.startswith(sandbox["DREAM_CONFIG_DIR"])
    shipped = playlists.load(ROOT)
    name = sorted(shipped)[0]
    playlists.save_user(name, ["my own scene"])
    playlists.save_user("Mine", ["one", "two"])
    lists = playlists.load(ROOT, {"AI: temp": ["t1"]})
    assert lists[name] == ["my own scene"] and lists["Mine"] == ["one", "two"] and lists["AI: temp"] == ["t1"]
    assert playlists.names(ROOT)[-1] == playlists.SURPRISE
    playlists.save_user(name, None)
    assert playlists.load(ROOT)[name] == shipped[name]
    with open(playlists.USER_FILE) as f:
        assert set(json.load(f)) == {"Mine"}


def test_old_names_in_the_own_file(sandbox):
    os.makedirs(os.path.dirname(playlists.USER_FILE), exist_ok=True)
    with open(playlists.USER_FILE, "w") as f:
        json.dump({"Feuer": ["embers"]}, f)                      # OLD_NAMES: saved by an earlier version
    assert playlists.load(ROOT)["Fire"] == ["embers"]


def test_keep_temp():
    temp = {}
    for i in range(playlists.TEMP_MAX + 2):
        playlists.keep_temp(temp, f"AI: {i}", [str(i)])
    assert list(temp) == [f"AI: {i}" for i in range(2, playlists.TEMP_MAX + 2)]


def test_parse_lines():
    text = "Here you go:\n1. a glowing jellyfish in a dark ocean\n- \"neon city at night in the rain\"\nshort one\n"
    assert playlists.parse_lines(text) == ["a glowing jellyfish in a dark ocean", "neon city at night in the rain"]


def test_surprise():
    rng = random.Random(4)
    s = playlists.surprise({"A": ["a slow river of light"]}, rng)
    assert s["prompt"].startswith("a slow river of light, ")
    assert playlists.surprise({}) is None

