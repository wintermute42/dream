"""Settings a device may set (#148, #175): types, ranges, NaN/Inf/huge numbers, what a guest may change."""
import asyncio
import math

import pytest


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), "nan", "NaN", "inf", "-Infinity", "1e999",
                                   True, False, None, [], {}, [0.5], b"0.5", "", "half", "0x10"])
def test_coerce_number_refuses(server, value):
    with pytest.raises((ValueError, TypeError, OverflowError)):
        server.coerce_number("strength", value)


def test_coerce_number_huge_int_overflows(server):
    with pytest.raises(OverflowError):
        server.coerce_number("strength", 10 ** 400)


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
    got = server.coerce_number(key, value)
    assert got == pytest.approx(want) and type(got) is type(server.DEFAULT_STATE[key])


def test_every_number_has_a_range(server):
    """#175: a number a device can set is clamped – the fallback range is only for numbers not shown as a slider."""
    numbers = {k for k, v in server.DEFAULT_STATE.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    for k in numbers:
        lo, hi = server.RANGES.get(k, (-1e6, 1e6))
        assert math.isfinite(lo) and math.isfinite(hi) and lo < hi
        d = server.DEFAULT_STATE[k]
        assert lo <= d <= hi, k
    assert set(server.RANGES) <= set(server.DEFAULT_STATE)


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
    assert server.coerce(key, value) == want


@pytest.mark.parametrize("key,value", [("mode", "evil"), ("backend", "elsewhere"), ("model", "big-model"),
                                       ("music", "radio"), ("flowtrack", "maybe"), ("aspect", "round"),
                                       ("music_pattern", "Waltz"), ("beat_snap", "sometimes"), ("strength", "nan")])
def test_coerce_refuses(server, key, value):
    with pytest.raises(ValueError):
        server.coerce(key, value)


def test_apply_takes_only_clean_values(server, monkeypatch):
    before = dict(server.state)
    monkeypatch.setattr(server, "save_state", lambda: None)
    try:
        asyncio.run(server.apply({"strength": float("nan"), "zoom": "inf", "mode": "evil", "unknown": 1,
                                  "hue": 1e400, "prompt": "a calm sea", "seed": 3}))
        assert server.state["prompt"] == "a calm sea" and server.state["seed"] == 3
        for k in ("strength", "zoom", "mode", "hue"):
            assert server.state[k] == before[k]
        assert "unknown" not in server.state
    finally:
        server.state.clear()
        server.state.update(before)


def test_save_state_never_writes_nan(server, monkeypatch):
    monkeypatch.setitem(server.state, "strength", float("nan"))
    with pytest.raises(ValueError):
        server.save_state()


# ---------- what a guest may do (#148) ----------
def test_guest_keys_are_pinned(server):
    """Changing what guests may do is a decision: this list changes only with it."""
    assert server.GUEST_KEYS == {"prompt", "strength", "mix", "zoom", "rot", "hue", "drift", "smooth", "drift_prompt",
                                 "seed", "mode", "fx", "fx_amt", "fx_beat", "style", "style_amt", "sens", "music_pattern"}
    assert server.rights.GUEST_CMDS == {"next", "tap", "tapoff", "make", "fx"}
    assert server.GUEST_MODES == {"dream", "img", "vid"}
    assert server.GUEST_KEYS <= set(server.DEFAULT_STATE)


@pytest.mark.parametrize("key", ["backend", "model", "running", "playlist", "syphon", "cam_device", "flow_device",
                                 "auto", "auto_cam", "quality", "size", "master", "touch_paint", "pose", "music_drop",
                                 "style_ref", "flowtrack", "motion", "calib", "music", "beat_snap"])
def test_guest_may_not_change(server, key):
    """Money (cloud, bigger pictures), the owner's files, the Mac's camera, the performer's tools: not for guests."""
    assert server.guest_changes({key: server.DEFAULT_STATE[key]}) == {}


def test_guest_changes(server):
    got = server.guest_changes({"prompt": "p", "zoom": 0.01, "mode": "cam", "backend": "cloud"})
    assert got == {"prompt": "p", "zoom": 0.01}
    assert server.guest_changes({"mode": "flow"}) == {}
    assert server.guest_changes({"mode": "vid"}) == {"mode": "vid"}


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
                                 "pose_scale", "master", "fx_amt"}
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
