"""#247: the picture size has fixed values (settings.SIZES). A size the pages' lists do not offer – 640 over /ctl –
left the stage's list without a choice, its next picture was 0×0 and the stage stood still without a word. Any other
number becomes the nearest size in the server, for every way in, and the stage builds a picture whatever its list says."""
import json
import os
import re

import pytest

from test_rights import client, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401  (the roles' devices; nothing left behind)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def page(name: str) -> str:
    with open(os.path.join(ROOT, "static", name), encoding="utf-8") as f:
        return f.read()


@pytest.mark.parametrize("value,want", [
    (640, 512), (641, 768), (500, 512), (448, 384), (449, 512), (896, 768), (897, 1024), (256, 384), (1, 384),
    (5000, 1024), ("640", 512), (700.4, 768), (384, 384), (512, 512), (768, 768), (1024, 1024),
])
def test_any_size_becomes_one_dream_has(server, value, want):
    got = server.settings.coerce("size", value)
    assert got == want and type(got) is int
    assert got in server.settings.SIZES


def test_a_saved_size_between_the_sizes_heals(server):
    assert server.settings.loaded({"size": 640})["size"] == 512
    assert server.settings.loaded({"size": "nonsense"})["size"] == server.settings.DEFAULT_STATE["size"]


def test_the_table_knows_the_sizes_and_tells_the_pages(server):
    s = server.settings.SETTINGS["size"]
    assert s.steps == server.settings.SIZES == tuple(sorted(server.settings.SIZES))
    assert (s.lo, s.hi) == (min(s.steps), max(s.steps)) and s.default in s.steps
    assert server.settings.page_schema()["size"]["steps"] == list(server.settings.SIZES)
    for k, other in server.settings.SETTINGS.items():      # a stepped setting is a number whose default is a step
        if other.steps:
            assert other.number and other.default in other.steps, k


def test_a_size_over_ctl_that_no_list_offers_is_rounded_for_everyone(server, saved_state):
    """The stage never hears 640: it hears 512 – and so does the device that asked, which is not told its own changes
    otherwise."""
    server.hub.state.update(size=768)
    with client(server, "local").websocket_connect(ws_url(server, "/ctl", "local") + "?role=stage") as stage:
        with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ctl:
            ctl.send_text(json.dumps({"set": {"size": 640}}))
            wait_until(lambda: server.hub.state["size"] == 512)
            ctl.send_text(json.dumps({"set": {"size": 1024}}))     # a size of the list: no echo to the one who set it
            wait_until(lambda: server.hub.state["size"] == 1024)
            ctl.send_text(json.dumps({"set": {"prompt": "the end of the test"}}))
            wait_until(lambda: server.hub.state["prompt"] == "the end of the test")
            server.hub.outbox.post(next(c for c, k in server.hub.clients.items() if k == "remote"), json.dumps({"end": 1}))
            server.hub.outbox.post(next(c for c, k in server.hub.clients.items() if k == "stage"), json.dumps({"end": 1}))
            heard = {"stage": [], "ctl": []}
            for name, sock in (("ctl", ctl), ("stage", stage)):
                while True:
                    m = sock.receive_json()
                    if m.get("end"):
                        break
                    if "size" in m.get("set", {}):
                        heard[name].append(m["set"]["size"])
    assert heard["stage"] == [512, 1024]
    assert heard["ctl"] == [512]


def test_the_pages_offer_exactly_the_sizes(server):
    sizes = list(server.settings.SIZES)
    for name in ("index.html", "remote.html"):
        select = re.search(r'<select id="size"[^>]*>(.*?)</select>', page(name), re.S).group(1)
        assert [int(v) for v in re.findall(r'<option value="(\d+)"', select)] == sizes, name
    listed = re.search(r"const SIZES = \[([\d, ]+)\]", page("common.js")).group(1)
    assert [int(v) for v in listed.split(",")] == sizes
    assert f"SIZE_DEFAULT = {server.settings.DEFAULT_STATE['size']}" in page("common.js")


def test_the_stage_never_builds_its_picture_from_the_list_alone():
    stage = page("index.html")
    assert "const dims = () => DreamCommon.picSize(ui.size.value, wide());" in stage
    assert "function dims()" not in stage


def test_the_renderer_is_prepared_for_sizes_dream_has(server):
    """What a model is compiled for at the start are sizes the setting can have (render.START_SIZES)."""
    src = open(os.path.join(ROOT, "render.py"), encoding="utf-8").read()
    start = [int(v) for v in re.search(r"^START_SIZES = \(([\d, ]+)\)", src, re.M).group(1).split(",")]
    assert start and set(start) <= set(server.settings.SIZES)
