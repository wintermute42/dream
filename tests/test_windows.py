"""Dream windows (#201, #214): one large motif per window, motifs that wander without two windows showing the same, the
points of the painted faces found once on Dream's Mac – and windows that still only look."""
import asyncio
import json
import os
import random
import re
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from test_rights import client

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
FACE = "0123456789ab"


class Sock:
    """A window as Dream sees it: it only takes messages."""

    def __init__(self, n):
        self.n, self.got = n, []

    async def send_text(self, text):
        self.got.append(json.loads(text))


@pytest.fixture
def win(server, monkeypatch):
    """The windows part with nothing connected, and every message a window gets kept in its `got`."""
    w = server.windows
    for d in (server.hub.windows, w.motifs, w.marks, w.asked, server.eyes.aimasks):
        d.clear()
    w.markers.clear(); w.wanderers.clear()
    w.clock.update(wander=0.0, life=0.0, wave=0.0)
    monkeypatch.setattr(w.outbox, "post", lambda sock, text: sock.got.append(json.loads(text)) or True)
    yield w
    for d in (server.hub.windows, w.motifs, w.marks, w.asked, server.eyes.aimasks):
        d.clear()
    w.markers.clear(); w.wanderers.clear()


def come(server, n: int) -> list:
    socks = [Sock(i) for i in range(n)]
    for s in socks:
        server.windows.window_add(s)
        server.windows.window_greet(s)
    return socks


def kinds(win) -> list:
    return [m["kind"] for m in win.motifs.values()]


def apart(server, win) -> None:
    """No two windows show the same motif – except the pair of eyes: two windows, the left eye in the earlier one."""
    shown = kinds(win)
    single = [k for k in shown if k != win.PAIR]
    assert len(single) == len(set(single)), shown
    pair = [c for c, m in win.motifs.items() if m["kind"] == win.PAIR]
    assert len(pair) in (0, 2), shown
    if pair:
        order = list(server.hub.windows)
        assert [win.motifs[order[i]]["half"] for i in sorted(order.index(c) for c in pair)] == [0, 1]
        assert win.motifs[pair[0]]["seed"] == win.motifs[pair[1]]["seed"]      # they look and blink together


def test_every_window_gets_a_motif_of_its_own(server, win):
    socks = come(server, 7)
    assert sorted(kinds(win)) == sorted(k for k in win.MOTIFS if k != "face")   # no face painted yet: no face to show
    for s in socks:
        m = next(x["motif"] for x in s.got if "motif" in x)
        assert m["kind"] == win.motifs[s]["kind"] and m["wait"] == 0 and abs(m["now"] / 1000 - time.time()) < 5
    server.eyes.aimasks["goddess"] = (FACE, b"jpeg", time.time())
    late = come(server, 1)[0]
    assert win.motifs[late] == {"kind": "face", "seed": win.motifs[late]["seed"], "face": f"/eyes/mask/{FACE}.jpg"}
    more = come(server, 3)                              # more windows than motifs: then, and only then, one is shown twice
    assert max(kinds(win).count(k) for k in win.MOTIFS) == 2 and len(more) == 3


def test_a_motif_wanders_to_another_window(server, win, monkeypatch):
    """It dissolves in one window and forms again in another one a few seconds later – the same motif (kind and seed);
    the window it left gets one that nobody shows."""
    monkeypatch.setattr(win, "PAIR_CHANCE", 0.0)
    socks = come(server, 4)
    before = {s: dict(win.motifs[s]) for s in socks}
    for s in socks:
        s.got.clear()
    plan = win.wander()
    win.motifs_set(plan)
    assert len(plan) == 2
    (dst, src) = sorted(plan, key=lambda c: plan[c][1])
    assert plan[dst][1] == win.DISSOLVE and plan[src][1] == 2 * win.DISSOLVE
    assert win.motifs[dst] == before[src]                                       # the same being, somewhere else
    assert win.motifs[src]["kind"] != before[src]["kind"]                       # and something else where it was …
    apart(server, win)                                                          # … that no other window shows
    for s in socks:                                                             # only the two windows hear of it
        assert [list(m) for m in s.got] == ([["motif"]] if s in plan else [])
    assert dst.got[0]["motif"]["wait"] == win.DISSOLVE


def test_wandering_never_shows_a_motif_twice(server, win):
    random.seed(214)
    for n in (2, 3, 5, 7):
        for d in (server.hub.windows, win.motifs):
            d.clear()
        come(server, n)
        apart(server, win)
        pairs = 0
        for _ in range(300):
            win.motifs_set(win.wander())
            assert set(win.motifs) == set(server.hub.windows)
            apart(server, win)
            pairs += win.PAIR in kinds(win)
        assert 0 < pairs < 300                          # the pair of eyes comes, and goes again


def test_a_single_window_changes_its_motif(server, win):
    s = come(server, 1)[0]
    for _ in range(20):
        was = win.motifs[s]["kind"]
        plan = win.wander()
        win.motifs_set(plan)
        assert list(plan) == [s] and plan[s][1] == win.DISSOLVE and win.motifs[s]["kind"] not in (was, win.PAIR)


def test_the_pair_of_eyes(server, win, monkeypatch):
    monkeypatch.setattr(win, "PAIR_CHANCE", 1.0)
    socks = come(server, 4)
    win.motifs_set(win.wander())                        # it opens in two windows next to each other
    apart(server, win)
    pair = [s for s in socks if win.motifs[s]["kind"] == win.PAIR]
    assert len(pair) == 2 and abs(pair[0].n - pair[1].n) == 1
    with monkeypatch.context() as mp:
        mp.setattr(win.random, "choice", lambda seq: pair[0] if pair[0] in seq else seq[0])
        win.motifs_set(win.wander())                    # it moves on together: into the two other windows
    apart(server, win)
    moved = [s for s in socks if win.motifs[s]["kind"] == win.PAIR]
    assert len(moved) == 2 and not set(moved) & set(pair)
    import asyncio
    asyncio.run(win.window_remove(moved[0]))            # one of the two windows goes: half a pair is no pair
    assert win.PAIR not in kinds(win) and moved[0] not in win.motifs
    apart(server, win)


def test_a_face_whose_picture_is_gone_wanders_as_a_face_of_now(server, win, monkeypatch):
    monkeypatch.setattr(win, "PAIR_CHANCE", 0.0)
    server.eyes.aimasks["goddess"] = (FACE, b"jpeg", time.time())
    socks = come(server, 8)
    src = next(s for s in socks if win.motifs[s]["kind"] == "face")
    server.eyes.aimasks["goddess"] = ("ba9876543210", b"jpeg", time.time())      # painted anew: another picture
    monkeypatch.setattr(win.random, "choice", lambda seq: src if src in seq else seq[0])
    plan = win.wander()
    moved = next(m for m, _ in plan.values() if m["kind"] == "face")
    assert moved["face"] == "/eyes/mask/ba9876543210.jpg"


def test_what_dream_tells_a_window_is_small(server, win):
    """A motif is a few bytes – no prompt, no setting, no picture; a small being's seed too."""
    server.eyes.aimasks["goddess"] = (FACE, b"jpeg", time.time())
    socks = come(server, 9)
    for _ in range(50):
        win.motifs_set(win.wander())
    sent = [m["motif"] for s in socks for m in s.got if "motif" in m]
    assert len(sent) > 50
    for m in sent:
        assert set(m) <= {"kind", "seed", "wait", "now", "half", "face"} and len(json.dumps(m)) < 140
    seed = win.window_seed("moth", "left")
    assert set(seed) == {"id", "kind", "seed", "life", "enter", "exit", "hue", "size"} and seed["exit"] != "left"


def test_small_beings_drift_from_window_to_window(server, win, monkeypatch):
    """A being of light that leaves one window comes into the next one from the other side – the same being."""
    import asyncio
    one, two = come(server, 2)
    monkeypatch.setattr(win.random, "randrange", lambda n: 0)                    # it sets out in the first window
    win.clock.update(wander=1e12, wave=1e12)
    asyncio.run(win.windows_tick(100.0))
    seed = next(m["life"] for m in one.got if "life" in m)
    assert seed["kind"] in win.LIFE_KINDS
    asyncio.run(win.windows_tick(100.0 + seed["life"] + 0.1))
    nxt = next(m["life"] for m in two.got if "life" in m)
    assert (nxt["seed"], nxt["kind"]) == (seed["seed"], seed["kind"])
    assert nxt["enter"] == win.OPPOSITE[seed["exit"]]


def test_the_timer_lets_a_motif_wander(server, win):
    import asyncio
    socks = come(server, 3)
    for s in socks:
        s.got.clear()
    asyncio.run(win.windows_tick(1000.0))               # the first tick only sets the clock
    assert not any("motif" in m for s in socks for m in s.got)
    assert win.WANDER_MIN <= win.clock["wander"] - 1000.0 <= 3 * win.WANDER_MIN and win.WANDER_MIN >= 60
    asyncio.run(win.windows_tick(win.clock["wander"] + 0.1))
    assert any("motif" in m for s in socks for m in s.got)
    apart(server, win)


# ---------- the points of the painted faces: found once per face, on Dream's Mac, never per window ----------
def points(win) -> list:
    return [(i * 37) % 1001 for i in range(2 * win.FACE_POINTS)]


def test_face_points_are_asked_for_once_however_many_windows(server, win):
    server.eyes.aimasks["goddess"] = (FACE, b"jpeg", time.time())
    stage = Sock("stage")
    win.marks_tick(100.0)                               # no window, no stage: nothing to ask
    assert not win.asked
    win.markers.append(stage)
    win.marks_tick(100.0)                               # no window looks: no face is looked at
    assert not stage.got
    socks = come(server, 12)
    for now in (100.0, 100.5, 101.0, 105.0):
        win.marks_tick(now)
    assert stage.got == [{"face": FACE, "url": f"/eyes/mask/{FACE}.jpg"}]        # one question, not twelve
    assert win.marks_take({"face": FACE, "points": points(win)}) == FACE
    for now in (130.0, 200.0, 900.0):
        win.marks_tick(now)
    assert len(stage.got) == 1                                                  # and never again for this face
    late = come(server, 1)[0]                                                   # a window that comes later gets them with the face
    assert {"marks": {FACE: points(win)}} in late.got and len(json.dumps(win.marks_msg())) < 1200
    assert not any("marks" in m for s in socks for m in s.got)                  # (the others got them from the route, below)


def test_face_points_are_asked_for_when_only_dreamy_eyes_look_on(server, win):
    """#230: Dreamy Eyes move the painted faces too – with no window open they are who the points are found for."""
    server.eyes.aimasks["goddess"] = (FACE, b"jpeg", time.time())
    stage, eyes, guest = Sock("stage"), Sock("eyes"), Sock("guest")
    win.markers.append(stage)
    server.hub.roles[guest] = "guest"
    try:
        win.marks_tick(100.0)                           # a guest's remote shows no face
        assert not stage.got and win.lookers() == []
        server.hub.roles[eyes] = "eyes"
        for now in (100.0, 100.5, 105.0):
            win.marks_tick(now)
        assert stage.got == [{"face": FACE, "url": f"/eyes/mask/{FACE}.jpg"}] and win.lookers() == [eyes]
        window = come(server, 1)[0]
        assert win.lookers() == [window, eyes]
        win.marks_greet(eyes)                           # no points yet: nothing to hand on
        assert not eyes.got
        assert win.marks_take({"face": FACE, "points": points(win)}) == FACE
        win.marks_greet(eyes)
        assert eyes.got == [{"marks": {FACE: points(win)}}]
    finally:
        server.hub.roles.pop(eyes, None); server.hub.roles.pop(guest, None)


def test_a_face_without_points_stays_still(server, win):
    server.eyes.aimasks["cat"] = (FACE, b"jpeg", time.time())
    stage = Sock("stage")
    win.markers.append(stage)
    come(server, 2)
    good = points(win)
    for bad in (None, [], good[:-1], good + [1], [0.5] * len(good), [-1] + good[1:], [1001] + good[1:], [True] + good[1:], "x" * len(good)):
        win.marks.clear()
        assert win.marks_take({"face": FACE, "points": bad}) is None
        assert win.marks == {FACE: None} and win.marks_msg() == {"marks": {}}    # looked at, no face: not asked again
    win.marks_tick(500.0)
    assert not stage.got
    win.marks.clear()
    for msg in ({"face": "ffffffffffff", "points": good}, {"face": "../../x", "points": good}, {"points": good}, [], "x", None):
        assert win.marks_take(msg) is None and not win.marks                     # not a face Dream painted: not kept
    for now in (1000.0, 1030.0, 1060.0, 1090.0):                                # a stage that never answers is asked twice, then no more
        win.marks_tick(now)
    assert len(stage.got) == win.MARKS_TRIES and win.marks == {FACE: None}
    server.eyes.aimasks.clear()                                                 # the face is gone: so is what Dream knew of it
    win.marks_tick(2000.0)
    assert not win.marks and not win.asked


def test_the_stage_answers_and_every_window_gets_the_points(server):
    """Over the real routes: Dream asks the stage on this Mac, the stage answers, the windows get the points."""
    w = server.windows
    for d in (server.hub.windows, w.motifs, w.marks, w.asked, server.eyes.aimasks):
        d.clear()
    server.eyes.aimasks["goddess"] = (FACE, b"jpeg", time.time())
    k = server.rights.keys["window"]

    def first(ws, key):
        for _ in range(30):
            m = json.loads(ws.receive_text())
            if key in m:
                return m[key]

    try:
        with client(server, "local").websocket_connect("ws://127.0.0.1:7860/facemarks") as stage, \
                client(server, "window").websocket_connect(f"ws://192.168.1.20:7860/view?as=window&k={k}") as a, \
                client(server, "window").websocket_connect(f"ws://192.168.1.20:7860/view?as=window&k={k}") as b:
            assert first(a, "aimasks") == {"goddess": f"/eyes/mask/{FACE}.jpg"}
            assert first(a, "motif")["kind"] in w.MOTIFS and first(b, "motif")["kind"] in w.MOTIFS
            w.marks_tick(time.time())
            assert json.loads(stage.receive_text()) == {"face": FACE, "url": f"/eyes/mask/{FACE}.jpg"}
            stage.send_text("not json")
            stage.send_text(json.dumps({"face": FACE, "points": points(w)}))
            assert first(a, "marks") == {FACE: points(w)} and first(b, "marks") == {FACE: points(w)}
            a.send_text(json.dumps({"face": FACE, "points": [0] * (2 * w.FACE_POINTS)}))   # a window cannot say where a face is
            a.send_text(json.dumps({"set": {"prompt": "x"}, "motif": {"kind": "eye"}}))      # nor anything else
        assert w.marks[FACE] == points(w)
        with pytest.raises(WebSocketDisconnect) as e:                           # and it is not the stage
            with client(server, "window").websocket_connect(f"ws://192.168.1.20:7860/facemarks?k={k}"):
                pass
        assert e.value.code == 4403
        assert not w.markers
    finally:
        for d in (server.hub.windows, w.motifs, w.marks, w.asked, server.eyes.aimasks, server.hub.key_roles, server.hub.viewers):
            d.clear()


# ---------- the pages: what Dream and the windows agree on, and what a window never does ----------
def read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def test_dream_and_the_window_page_name_the_same_motifs_and_points(server):
    w = server.windows
    page = read("window.html")
    # #221: the eye and the painted face are the page's own, every other motif is drawn by the style world – all of
    # them by the first one, today's look (static/world-classic.js)
    own = set(re.findall(r"(\w+):", re.search(r"const DRAW = \{(.*?)\}", page).group(1)))
    assert "const MOTIFS = new Set(['eye', 'pair', 'face', ...DreamStyle.motifs()]);" in page
    world = {k.split(":")[0].strip() for k in re.search(r"\n    motif: \{(.*?)\}", read("world-classic.js")).group(1).split(",")}
    assert own == {"eye", "pair", "face"} and not own & world
    assert own | world == set(w.MOTIFS) | {w.PAIR}       # every motif Dream may name is drawn
    assert float(re.search(r"const FORM = (\d+);", page).group(1)) == w.DISSOLVE * 1000
    life = set(re.findall(r"'(\w+)'", re.search(r"const KINDS = new Set\(\[(.*?)\]\)", page).group(1)))
    assert life == set(w.LIFE_KINDS)
    groups = re.search(r"const GROUPS = \{(.*?)\n  \};", read("dreamface.js"), re.S).group(1)
    picked = [int(n) for row in re.findall(r"\[([\d, ]+)\]", groups) for n in row.split(",")]
    assert len(picked) == len(set(picked)) == w.FACE_POINTS


def test_a_window_never_looks_for_faces_itself():
    """The face model runs on Dream's Mac only (the stage asks for it with `data-detect`): a window loads no model –
    its key would not even get it (/mp is closed to windows, see test_rights) – and only moves the points it is given."""
    page = read("window.html")
    assert "/mp/" not in page and "data-detect" not in page and "FaceLandmarker" not in page
    assert '<script src="/static/dreamface.js" data-detect defer></script>' in read("index.html")
    assert "data-detect" not in read("eyes.html") and "data-detect" not in read("output.html")
    assert '<script src="/static/dreamface.js"></script>' in read("eyes.html")   # #230: Dreamy Eyes move the points they are given


def test_the_eye_is_drawn_by_one_module_for_both_pages():
    """#214: Dreamy Eyes and the windows draw the very same eye (static/dreameye.js) – no copy in either page.
    #221: both ask the style layer for it, and today's look – the first style world – is that very module."""
    eyes, window = read("eyes.html"), read("window.html")
    assert "eye: { draw: DreamEye.draw, irisWorld: DreamEye.irisWorld, pupilShape: DreamEye.pupilShape }" in read("world-classic.js")
    for page in (eyes, window):
        assert '<script src="/static/dreameye.js"></script>' in page and "DreamStyle.eye()" in page
        assert "style.draw(" in page and "style.irisWorld(" in page and "style.pupilShape(" in page
        for own in ("function irisWorld", "function pupilShape", "function almond(cx", "bezierCurveTo(cx - a * 0.45"):
            assert own not in page


# ---------- #221: the style world ----------
def test_a_window_is_told_the_style_world_when_it_comes_and_when_it_changes(server, win, monkeypatch):
    monkeypatch.setitem(server.hub.state, "world", "classic")
    first, = come(server, 1)
    assert [m["world"] for m in first.got if "world" in m] == ["classic"]
    first.got.clear()
    monkeypatch.setattr(server.settings, "WORLDS", ("classic", "other"))   # (a second world, for the test)
    monkeypatch.setitem(server.settings.SETTINGS, "world", server.settings.text("classic", choices=("classic", "other")))
    monkeypatch.setattr(server.eyes.outbox, "post", lambda sock, text: sock.got.append(json.loads(text)) or True)
    asyncio.run(server.hub.apply({"world": "other"}, persist=False))
    assert first.got == [{"world": "other"}]            # one small word, nothing else of the shared state
    first.got.clear()
    asyncio.run(server.hub.apply({"world": "no-such-world"}, persist=False))
    assert first.got == [] and server.hub.state["world"] == "other"    # an unknown world is not taken
