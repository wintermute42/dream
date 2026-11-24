"""Settings a device may set (#148, #175): types, ranges, NaN/Inf/huge numbers, what a guest may change."""
import asyncio
import json
import math
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), "nan", "NaN", "inf", "-Infinity", "1e999",
                                   True, False, None, [], {}, [0.5], b"0.5", "", "half", "0x10"])
def test_coerce_number_refuses(server, value):
    with pytest.raises((ValueError, TypeError, OverflowError)):
        server.settings.coerce_number("strength", value)


def test_coerce_number_huge_int_overflows(server):
    with pytest.raises(OverflowError):
        server.settings.coerce_number("strength", 10 ** 400)


@pytest.mark.parametrize("key,value,want", [
    ("strength", 0.3, 0.3),
    ("strength", "0.3", 0.3),
    ("strength", 5, 0.95),
    ("strength", -1, 0.0),
    ("strength", 1e300, 0.95),
    ("seed", -5, 0),
    ("seed", 2 ** 40, 2 ** 31 - 1),
    ("seed", 7.6, 8),
    ("quality", 2.4, 2),
    ("quality", 99, 4),
    ("size", 5, 256),
    ("interval", 1, 5),
    ("master", 2, 1.0),
    ("pose_scale", 0, 0.2),
    ("strength", "0.5" + "9" * 100, 0.5999999999999999),   # only the first 40 characters are read
])
def test_coerce_number_clamps(server, key, value, want):
    got = server.settings.coerce_number(key, value)
    assert got == pytest.approx(want) and type(got) is type(server.settings.DEFAULT_STATE[key])


def test_every_number_has_a_range(server):
    """#175: a number a device can set is clamped – the fallback range is only for numbers not shown as a slider."""
    numbers = {k for k, v in server.settings.DEFAULT_STATE.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    for k in numbers:
        lo, hi = server.settings.RANGES.get(k, (-1e6, 1e6))
        assert math.isfinite(lo) and math.isfinite(hi) and lo < hi
        d = server.settings.DEFAULT_STATE[k]
        assert lo <= d <= hi, k
    assert set(server.settings.RANGES) <= set(server.settings.DEFAULT_STATE)


@pytest.mark.parametrize("key,value,want", [
    ("running", 0, False),
    ("running", "yes", True),
    ("mode", "img", "img"),
    ("model", "sdxl-turbo", "sdxl-turbo"),
    ("style", "watercolour", "watercolour"),
    ("style", "aquarell", "watercolour"),              # OLD_STYLES: saved by an earlier version
    ("style", "unknown", ""),
    ("style_ref", "0123456789ab", "0123456789ab"),
    ("style_ref", "../../etc/x", ""),
    ("fx", "tunnel+bogus+tunnel+waves", "tunnel+waves"),
    ("music_pattern", "Flow", "Flow"),
    ("beat_snap", "phrase", "phrase"),
    ("prompt", "x" * 5000, "x" * 2000),
])
def test_coerce(server, key, value, want):
    assert server.settings.coerce(key, value) == want


@pytest.mark.parametrize("key,value", [("mode", "evil"), ("backend", "elsewhere"), ("model", "big-model"),
                                       ("music", "radio"), ("flowtrack", "maybe"), ("aspect", "round"),
                                       ("music_pattern", "Waltz"), ("beat_snap", "sometimes"), ("strength", "nan")])
def test_coerce_refuses(server, key, value):
    with pytest.raises(ValueError):
        server.settings.coerce(key, value)


def test_apply_takes_only_clean_values(server, monkeypatch):
    before = dict(server.hub.state)
    monkeypatch.setattr(server.hub, "save_state", lambda: None)
    try:
        asyncio.run(server.hub.apply({"strength": float("nan"), "zoom": "inf", "mode": "evil", "unknown": 1,
                                  "hue": 1e400, "prompt": "a calm sea", "seed": 3}))
        assert server.hub.state["prompt"] == "a calm sea" and server.hub.state["seed"] == 3
        for k in ("strength", "zoom", "mode", "hue"):
            assert server.hub.state[k] == before[k]
        assert "unknown" not in server.hub.state
    finally:
        server.hub.state.clear()
        server.hub.state.update(before)


def test_save_state_never_writes_nan(server, monkeypatch):
    monkeypatch.setitem(server.hub.state, "strength", float("nan"))
    with pytest.raises(ValueError):
        server.hub.save_state()


# ---------- what a guest may do (#148) ----------
def test_guest_keys_are_pinned(server):
    """Changing what guests may do is a decision: this list changes only with it."""
    assert server.settings.GUEST_KEYS == {"prompt", "strength", "mix", "zoom", "rot", "hue", "drift", "smooth", "drift_prompt",
                                 "seed", "mode", "fx", "fx_amt", "fx_beat", "style", "style_amt", "sens", "music_pattern"}
    assert server.rights.GUEST_CMDS == {"next", "tap", "tapoff", "make", "fx"}
    assert server.settings.GUEST_MODES == {"dream", "img", "vid"}
    assert server.settings.GUEST_KEYS <= set(server.settings.DEFAULT_STATE)


@pytest.mark.parametrize("key", ["backend", "model", "running", "playlist", "syphon", "cam_device", "flow_device",
                                 "auto", "auto_cam", "quality", "size", "master", "touch_paint", "pose", "music_drop",
                                 "style_ref", "flowtrack", "motion", "calib", "music", "beat_snap"])
def test_guest_may_not_change(server, key):
    """Money (cloud, bigger pictures), the owner's files, the Mac's camera, the performer's tools: not for guests."""
    assert server.settings.guest_changes({key: server.settings.DEFAULT_STATE[key]}) == {}


def test_guest_changes(server):
    got = server.settings.guest_changes({"prompt": "p", "zoom": 0.01, "mode": "cam", "backend": "cloud"})
    assert got == {"prompt": "p", "zoom": 0.01}
    assert server.settings.guest_changes({"mode": "flow"}) == {}
    assert server.settings.guest_changes({"mode": "vid"}) == {"mode": "vid"}


@pytest.mark.parametrize("request_line,ok", [
    ("GET /remote", True), ("GET /output", True), ("GET /health", True), ("GET /remote-info", True),
    ("GET /cloud", True), ("GET /static/remote.html", True), ("GET /media/abc.jpg", True),
    ("GET /style-ref/0123456789ab", True), ("GET /mp/vision.js", True), ("POST /gallery/a1/use", True),
    ("GET /control", False), ("GET /", False), ("GET /stats", False), ("GET /eyes", False), ("GET /qr.svg", False),
    ("POST /cloud/start", False), ("POST /gallery/a1/save", False), ("GET /media/a/b", False),
    ("POST /remote", False), ("GET /remote/x", False),
])
def test_guest_http(server, request_line, ok):
    assert bool(server.rights.GUEST_HTTP.fullmatch(request_line)) is ok


@pytest.mark.parametrize("path,ok", [
    ("/eyes", True), ("/eyes/mask/0123456789ab.jpg", True), ("/static/eyes.html", True), ("/mp/vision.js", True),
    ("/eyes/mask/x.jpg", False), ("/remote", False), ("/control", False), ("/health", False), ("/media/a.jpg", False),
])
def test_eyes_paths(server, path, ok):
    assert bool(server.rights.EYES_PATHS.fullmatch(path)) is ok


# ---------- one table for all of it (#189) ----------
def test_one_table_feeds_every_view():
    """Defaults, ranges, guests' keys and MIDI targets are read from settings.SETTINGS – an entry there is all a new
    setting needs."""
    import midi
    import settings
    table = settings.SETTINGS
    assert list(settings.DEFAULT_STATE) == list(table)
    assert set(settings.RANGES) == {k for k, s in table.items() if s.number}
    assert midi.TARGETS is settings.TARGETS
    assert set(midi.TARGETS) == {"strength", "mix", "zoom", "rot", "hue", "drift", "smooth", "sens", "motion_sens",
                                 "pose_scale", "master", "fx_amt", "world_mix"}
    for k, s in table.items():
        assert s.kind in ("bool", "int", "float", "text"), k
        if s.number:
            assert s.lo is not None and s.hi is not None and s.lo < s.hi, k
        else:
            assert s.lo is None and s.hi is None and not s.target, k
        if s.choices:
            assert s.default in s.choices, k
        if isinstance(s.guest, frozenset):
            assert s.guest <= set(s.choices), k           # a guest's values are some of the setting's own
        else:
            assert s.guest in (True, False), k
        assert settings.coerce(k, s.default) == s.default, k


# ---------- #216: what follows from the table for the sliders and for "Reset" ----------
def test_zero_in_the_middle_follows_from_the_range():
    import settings
    assert {k for k, s in settings.SETTINGS.items() if s.bipolar} == {"zoom", "rot"}
    schema = settings.page_schema()
    assert set(schema) == set(settings.RANGES)
    assert schema["zoom"] == {"d": 0.008, "lo": -0.04, "hi": 0.06, "zero": True, "w": 1.0}
    assert schema["fx_amt"] == {"d": 0.7, "lo": 0.0, "hi": 1.0, "w": 0.8, "needs": "fx"}
    assert schema["master"] == {"d": 1.0, "lo": 0.0, "hi": 1.0}                     # no weight: never coloured, never reset
    assert {k for k, e in schema.items() if e.get("zero")} == {"zoom", "rot"}
    json.dumps(schema, allow_nan=False)


def test_reset_brings_home_what_shapes_the_picture_and_nothing_else():
    import settings
    weighted = {k for k, s in settings.SETTINGS.items() if s.weight}
    assert weighted == {"flow", "strength", "mix", "zoom", "rot", "hue", "sens", "motion_sens", "pose_scale", "drift", "smooth",
                        "morph", "touch_amt", "edges_scale", "fx_amt"}
    # in one step, never gliding: effects, autopilot and the style (a style strength costs the AI a rebuild per change)
    assert settings.RESET == {**{k: settings.DEFAULT_STATE[k] for k in weighted}, "fx": "", "auto": False,
                              "music_pattern": "auto",
                              "style": "", "style_amt": 1.0, "style_ref": "", "style_ref_amt": 0.8,
                              "master": 1.0}                                    # #240: lit again at once
    assert not weighted & set(settings.RESET_AT_ONCE)
    # what stays, whatever else changes: the dream's content, the model and its cost, inputs, outputs, the cloud
    for kept in ("prompt", "model", "quality", "size", "aspect", "mode", "cam_device", "flow_device", "playlist", "interval",
                 "shuffle", "syphon", "backend", "seed", "running", "music", "calib", "music_patterns", "music_drop",
                 "beat_snap", "fx_beat", "drift_prompt", "touch_paint", "edges", "pose", "flowtrack", "motion"):
        assert kept not in settings.RESET, kept
    for k, s in settings.SETTINGS.items():
        assert 0 <= s.weight <= 1 and (not s.weight or s.number), k
        assert s.needs is None or (s.needs in settings.SETTINGS and s.weight), k


def test_the_defaults_are_a_calm_dream():
    """#216: "Reset" lands on these – a change here is a change of what the owner comes home to."""
    import settings
    d = settings.DEFAULT_STATE
    assert (d["strength"], d["zoom"], d["rot"], d["hue"]) == (0.45, 0.008, 0.2, 2.0)
    assert (d["smooth"], d["morph"], d["drift"], d["mix"], d["fx"], d["auto"]) == (0.3, 1.0, 0.5, 0.35, "", False)


@pytest.fixture
def quiet_hub(server, monkeypatch):
    """The hub alone: nothing is sent or saved, the glide takes a fraction of its four seconds."""
    sent = []

    async def broadcast(msg, exclude=None, only=None):
        sent.append(msg)
    before = dict(server.hub.state)
    monkeypatch.setattr(server.hub, "broadcast", broadcast)
    monkeypatch.setattr(server.hub, "save_soon", lambda: None)
    monkeypatch.setattr(server.hub, "GLIDE_SECS", 0.12)
    monkeypatch.setattr(server.hub, "GLIDE_STEP", 0.01)
    server.hub.state.update(server.settings.DEFAULT_STATE)
    yield sent
    server.hub.state.clear()
    server.hub.state.update(before)
    server.hub.undo.update(values=None, until=0.0)
    server.hub.gliding.update(task=None, keys=set())


def test_reset_glides_in_steps_and_ends_exactly(server, quiet_hub):
    hub = server.hub

    async def go():
        hub.state.update(rot=3.0, zoom=-0.04, fx="tunnel", auto=True)
        await hub.reset()
        await hub.gliding["task"]
    asyncio.run(go())
    steps = [m["set"]["rot"] for m in quiet_hub if "rot" in m.get("set", {})]
    assert len(steps) >= 4 and steps == sorted(steps, reverse=True), steps        # down, never a jump back
    assert max(a - b for a, b in zip([3.0] + steps, steps)) < 1.5                   # no hard jump
    assert steps[-1] == 0.2 and hub.state["zoom"] == 0.008
    assert quiet_hub[0] == {"set": {"fx": "", "auto": False}, "by": "reset"}       # the stage fades the effects itself


def test_reset_sets_the_music_pattern_to_automatic_and_undo_brings_it_back(server, quiet_hub):
    hub = server.hub

    async def go():
        hub.state.update(music_pattern="Jolt", music_patterns=False, fx_beat=False)
        await hub.reset()
        assert (hub.state["music_pattern"], hub.state["music_patterns"], hub.state["fx_beat"]) == ("auto", False, False)
        await hub.reset_undo()
    asyncio.run(go())
    assert [m["set"] for m in quiet_hub if "set" in m] == [{"music_pattern": "auto"}, {"music_pattern": "Jolt"}]
    assert hub.state["music_pattern"] == "Jolt"


def test_reset_changes_the_style_in_one_step_and_undo_too(server, quiet_hub):
    """The style and its strengths never glide: one message there, one back – the model is rebuilt at most once."""
    hub = server.hub
    style = {"style": "watercolour", "style_amt": 1.7, "style_ref": "0123456789ab", "style_ref_amt": 0.3}

    async def go():
        hub.state.update(style, rot=3.0)
        await hub.reset()
        await hub.gliding["task"]
        await hub.reset_undo()
        await hub.gliding["task"]
    asyncio.run(go())
    touching = [m["set"] for m in quiet_hub if set(m.get("set", {})) & set(style)]
    assert touching == [{"style": "", "style_amt": 1.0, "style_ref": "", "style_ref_amt": 0.8}, style]
    assert {k: hub.state[k] for k in style} == style and hub.state["rot"] == 3.0
    assert {"reset": {"undo": hub.UNDO_SECS}} in quiet_hub


def test_reset_with_nothing_to_do_offers_no_undo(server, quiet_hub):
    asyncio.run(server.hub.reset())
    assert quiet_hub == [{"reset": {"undo": 0}}] and server.hub.undo["values"] is None


def test_undo_only_for_its_seconds(server, quiet_hub):
    hub = server.hub

    async def go():
        hub.state.update(rot=3.0)
        await hub.reset()
        await hub.gliding["task"]
        hub.undo["until"] = 0.0                       # the ten seconds are over
        await hub.reset_undo()
    asyncio.run(go())
    assert hub.state["rot"] == 0.2 and not hub.gliding["keys"]
    assert not any(m.get("reset", {}).get("undone") for m in quiet_hub)


def test_a_hand_on_a_slider_takes_it_out_of_the_glide(server, quiet_hub):
    hub = server.hub

    async def go():
        hub.state.update(rot=3.0, hue=18.0)
        await hub.reset()
        await hub.apply({"rot": 1.7}, by="remote")
        await hub.gliding["task"]
    asyncio.run(go())
    assert (hub.state["rot"], hub.state["hue"]) == (1.7, 2.0)


def test_both_pages_draw_their_sliders_with_the_shared_file():
    """#216: default, range, zero mark and weight come with the schema – neither page keeps a list of its own."""
    for page in ("index.html", "remote.html"):
        src = open(os.path.join(ROOT, "static", page), encoding="utf-8").read()
        assert '<script src="/static/sliders.js"></script>' in src and '<link rel="stylesheet" href="/static/sliders.css">' in src, page
        assert "DreamSliders.create(" in src and "DreamSliders.resetButton($('reset')" in src, page
        assert "sliders.schema(m.schema)" in src, page
        assert not re.search(r"bipolar|sl-zero|sl-top", src), page
    remote = open(os.path.join(ROOT, "static", "remote.html"), encoding="utf-8").read()
    assert '<button id="reset" data-only="control" hidden>' in remote


def test_slider_animations_move_only_transform_and_opacity():
    css = open(os.path.join(ROOT, "static", "sliders.css"), encoding="utf-8").read()
    transitions = re.findall(r"transition:([^;]*);", css)
    assert transitions
    for line in transitions:
        assert {part.split()[0] for part in line.split(",")} <= {"opacity", "transform", "none"}, line
    frames = re.findall(r"@keyframes [\w-]+ \{((?:[^{}]*\{[^{}]*\})+)\s*\}", css)
    assert len(frames) == css.count("@keyframes") >= 2
    for body in frames:
        assert set(re.findall(r"([a-z-]+):", body)) <= {"opacity", "transform"}, body


def test_settings_load_without_torch(tmp_path):
    """The settings table needs no model library: it loads where torch is not installed."""
    import os
    import subprocess
    import sys
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    code = "import sys; sys.modules['torch'] = None; import settings, midi; print(len(settings.SETTINGS))"
    out = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, timeout=60,
                         env={**os.environ, "HOME": str(tmp_path)})
    assert out.returncode == 0 and int(out.stdout) > 50, out.stderr


def test_remote_page_hides_from_guests_what_they_may_not_change():
    """The remote page marks what is for Dream Control only (data-only="control", hidden for a guest); the table says
    what a guest may change. Both must agree for every setting the page has a control for (#189)."""
    import os
    import re
    from html.parser import HTMLParser

    import settings
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = open(os.path.join(root, "static", "remote.html"), encoding="utf-8").read()
    fields = re.findall(r"'([a-z_]+)'", re.search(r"const FIELDS = \[(.*?)\];", src, re.S).group(1))

    class Page(HTMLParser):
        def __init__(self):
            super().__init__()
            self.open, self.control_only, self.never_shown = [], {}, set()

        def handle_starttag(self, tag, attrs):
            a = dict(attrs)
            only = a.get("data-only") == "control"
            if a.get("id"):
                self.control_only[a["id"]] = only or any(o for _, o in self.open)
                if "hidden" in a:
                    self.never_shown.add(a["id"])
            if tag not in ("input", "br", "img", "meta", "link", "hr"):
                self.open.append((tag, only))

        def handle_endtag(self, tag):
            while self.open and self.open.pop()[0] != tag:
                pass

    page = Page()
    page.feed(src)
    assert len(fields) > 30 and set(fields) <= set(settings.SETTINGS)
    for k in fields:
        if k in page.never_shown:                      # a hidden carrier of a value (its visible switch is marked)
            continue
        assert page.control_only[k] is (k not in settings.GUEST_KEYS), k


def test_both_pages_show_the_signs_with_the_shared_file():
    """#217: the moving signs and the shape of the picture's character are drawn by signs.js for both pages, hung into
    the sliders' drawing; nothing in its style sheet moves by itself (signs.js animates transform and opacity only –
    tests/js/signs.test.mjs)."""
    for page in ("index.html", "remote.html"):
        src = open(os.path.join(ROOT, "static", page), encoding="utf-8").read()
        assert '<script src="/static/signs.js"></script>' in src and '<link rel="stylesheet" href="/static/signs.css">' in src, page
        assert "DreamSliders.create({ painted: signs.paint," in src and "signs.shape" in src and "signs.tempo(" in src, page
        assert not re.search(r"sg-(turn|rings|wheel|trail|grow|bars)", src), page
    css = open(os.path.join(ROOT, "static", "signs.css"), encoding="utf-8").read()
    assert not re.search(r"animation|transition|@keyframes", re.sub(r"/\*.*?\*/", "", css, flags=re.S))


def test_the_style_world_is_one_entry_in_the_table():
    """#221: the style world of Dreamy Eyes and the dream windows – a choice among settings.WORLDS, today's look first
    and the default; Dream Control's and this Mac's to set, not a guest's; a MIDI button steps to the next one."""
    import midi
    import settings
    s = settings.SETTINGS["world"]
    assert s.choices == settings.WORLDS and s.default == settings.WORLDS[0] == "classic"
    assert "world" not in settings.GUEST_KEYS and settings.guest_changes({"world": "classic"}) == {}
    assert settings.coerce("world", "classic") == "classic"
    with pytest.raises(ValueError):
        settings.coerce("world", "../etc")
    assert settings.loaded({"world": "classic"})["world"] == "classic"
    assert "world" in midi.ACTIONS and "world" not in midi.TARGETS and "world" not in settings.RESET
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for page in ("index.html", "remote.html"):
        with open(os.path.join(here, "static", page), encoding="utf-8") as f:
            src = f.read()
        assert '<option value="world">Button: next style world</option>' in src
        # #224: the worlds are offered by the band of worlds, from Dream's own list (told over /ctl) – no list in a page
        assert '<div id="worldband"></div>' in src and "worldBand.worlds(m.worlds)" in src and '<select id="world"' not in src, page
    with open(os.path.join(here, "static", "worldband.js"), encoding="utf-8") as f:
        names = re.search(r"const NAMES = \{(.*?)\n  \};", f.read(), re.S).group(1)
    assert tuple(re.findall(r"^\s+([a-z][a-z0-9-]*): \(\) => T\(", names, re.M)) == settings.WORLDS   # each with its name
