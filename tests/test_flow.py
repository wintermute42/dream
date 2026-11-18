"""The flow field between two AI pictures (#205): the estimate finds a known motion and gives up on pictures that have
nothing in common, the field travels small with the picture that follows from the one before (not after a cut, not
unasked), and the Syphon source morphs with it. No model: a stand-in paints the pictures."""
import base64
import io
import json
import time

import numpy as np
import pytest
from PIL import Image
from starlette.testclient import TestClient

import flow


def scene(seed: int, w: int = 544, h: int = 288) -> Image.Image:
    """An invented picture with soft shapes, as a dream has them."""
    rng = np.random.default_rng(seed)
    coarse = Image.fromarray((rng.random((h // 32, w // 32, 3)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    fine = Image.fromarray((rng.random((h // 8, w // 8, 3)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return Image.blend(coarse, fine, 0.4)


def cut(img: Image.Image, x: int, w: int = 512) -> Image.Image:
    return img.crop((x, 0, x + w, img.height))


# ---------- the estimate ----------
def test_a_known_motion_is_found():
    wide = scene(1)
    old, new = cut(wide, 20), cut(wide, 4)             # everything moves 16 pixels to the right
    field, confidence = flow.estimate(flow.gray(old), flow.gray(new))
    assert confidence > 0.9
    assert field.shape == (27, 48, 2)
    inner = field[4:-4, 6:-6]                          # the edge has nothing to follow
    assert abs(float(np.median(inner[..., 0])) * 512 - 16) < 2.5
    assert abs(float(np.median(inner[..., 1])) * 288) < 1.5


def test_a_still_picture_has_no_motion():
    img = cut(scene(2), 0)
    field, confidence = flow.estimate(flow.gray(img), flow.gray(img))
    assert confidence == 1.0 and float(np.abs(field).max()) < 1e-3


def test_pictures_with_nothing_in_common_get_no_field():
    field, confidence = flow.estimate(flow.gray(cut(scene(3), 0)), flow.gray(cut(scene(4), 0)))
    assert field is None and confidence == 0.0


def test_pictures_of_different_sizes_get_no_field():
    assert flow.estimate(flow.gray(scene(5, 512, 288)), flow.gray(scene(5, 512, 512))) == (None, 0.0)


def test_where_the_field_explains_nothing_its_vectors_shrink():
    wide = scene(6)
    old, new = cut(wide, 20), cut(wide, 4)
    patch = scene(7, 160, 288)                         # the right part of the new picture is something else
    new.paste(patch, (352, 0))
    field, confidence = flow.estimate(flow.gray(old), flow.gray(new))
    assert field is not None and 0 < confidence
    left, right = np.abs(field[6:-6, 6:20, 0]).mean(), np.abs(field[6:-6, 38:46, 0]).mean()
    assert right < 0.4 * left


# ---------- how it travels ----------
def test_the_field_travels_in_under_three_kilobytes():
    wide = scene(1)
    field, confidence = flow.estimate(flow.gray(cut(wide, 20)), flow.gray(cut(wide, 4)))
    packed = flow.pack(field, confidence)
    assert packed[:4] == b"DRMF" and len(packed) < 3000
    back, c = flow.unpack(packed)
    assert back.shape == field.shape and abs(c - confidence) < 0.01
    assert float(np.abs(back - field).max()) <= 0.5 / flow.UNIT + 1e-6
    square = scene(8, 512, 512)
    field, confidence = flow.estimate(flow.gray(square), flow.gray(square))
    assert field.shape == (36, 36, 2) and len(flow.pack(field, confidence)) < 3000


@pytest.mark.parametrize("data", [b"", b"DRMF", b"JPEG" + bytes(2600), b"DRMF" + bytes((48, 27, 255, 0)) + bytes(10)])
def test_what_is_not_a_field_is_not_unpacked(data):
    assert flow.unpack(data) == (None, 0.0)


def test_a_vector_too_long_for_a_byte_is_cut_off():
    field = np.full((27, 48, 2), 0.9, dtype=np.float32)
    back, _ = flow.unpack(flow.pack(field, 1.0))
    assert float(back.max()) == pytest.approx(127 / flow.UNIT)


# ---------- the Syphon source's morph ----------
def test_between_two_pictures_the_shapes_are_half_way():
    wide = scene(9).convert("RGBA")
    old, new, middle = (np.asarray(cut(wide, x)) for x in (20, 4, 12))
    field = np.zeros((27, 48, 2), dtype=np.float32)
    field[..., 0] = 16 / 512
    way = flow.Between(old, new, field)
    assert np.array_equal(way.at(0.0), old) and np.array_equal(way.at(1.0), new)
    inner = (slice(None), slice(16, -16))
    morphed = np.abs(way.at(0.5)[inner].astype(int) - middle[inner]).mean()
    faded = np.abs((old[inner].astype(int) + new[inner]) // 2 - middle[inner]).mean()
    assert morphed < 1.5 and faded > 4 * morphed


# ---------- the render line: the field comes with the picture that follows from the one before ----------
@pytest.fixture
def painting(server, monkeypatch):
    """The stage's line to the renderer with a stand-in for the model: picture n is the scene moved 8 pixels further
    than the one before; seed 38 paints another scene."""
    wide = {seed: scene(seed, 640, 288) for seed in (1, 38)}
    count = {"n": 0}

    def dream(key, img, prompt, strength, steps, seed, *args, **kw):
        count["n"] += 1
        return cut(wide[38 if seed == 38 else 1], 100 - 8 * count["n"]), key
    monkeypatch.setattr(server.render, "dream", dream)
    monkeypatch.setitem(server.render_api.flow_process, "use", False)      # the estimate in a thread: no process per test
    return TestClient(server.app, base_url="http://127.0.0.1:7860", client=("127.0.0.1", 50001))


def jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 36), "navy").save(buf, "JPEG")
    return buf.getvalue()


def picture(ws, **settings):
    """One frame to the renderer; returns (the field that came ahead of the picture or None, the timing message)."""
    ws.send_text(json.dumps({"prompt": "a calm sea", "strength": 0.5, "steps": 2, "seed": 1, "model": "sd-turbo", **settings}))
    ws.send_bytes(jpeg())
    field = None
    while True:
        m = ws.receive()
        if m.get("bytes") is not None:
            if m["bytes"][:4] == b"DRMF":
                assert field is None, "one field per picture"
                field = m["bytes"]
                continue
            Image.open(io.BytesIO(m["bytes"])).verify()        # the picture itself
        elif "ms" in json.loads(m["text"]):
            return field, json.loads(m["text"])


def test_the_field_comes_ahead_of_the_picture_that_follows(painting):
    with painting.websocket_connect("ws://127.0.0.1:7860/ws") as ws:
        first, timing = picture(ws, flow=True)
        assert first is None and "flow_ms" in timing           # nothing before the first picture
        second, timing = picture(ws, flow=True)
        vectors, confidence = flow.unpack(second)
        assert confidence > 0.5 and len(second) < 3000 and timing["flow_ms"] >= 0
        assert abs(float(np.median(vectors[4:-4, 6:-6, 0])) * 512 - 8) < 2.5


def test_no_field_unless_the_stage_asks(painting):
    with painting.websocket_connect("ws://127.0.0.1:7860/ws") as ws:
        picture(ws)
        field, timing = picture(ws)
        assert field is None and "flow_ms" not in timing
        assert picture(ws, flow=True)[0] is None               # switched on: the next pair is the first with a field
        assert picture(ws, flow=True)[0] is not None


def test_a_new_seed_is_a_cut(painting):
    with painting.websocket_connect("ws://127.0.0.1:7860/ws") as ws:
        picture(ws, flow=True)
        assert picture(ws, flow=True)[0] is not None
        assert picture(ws, flow=True, seed=38)[0] is None      # a new motif: no field, the stage cross-fades
        assert picture(ws, flow=True, seed=38)[0] is not None


def test_the_drift_towards_the_next_seed_is_no_cut(painting):
    with painting.websocket_connect("ws://127.0.0.1:7860/ws") as ws:
        picture(ws, flow=True, seed=1, seed2=2, st=0.9)
        assert picture(ws, flow=True, seed=2, seed2=3, st=0.0)[0] is not None   # the seed the drift was blending towards


def test_a_failing_estimate_costs_no_picture(painting, server, monkeypatch):
    def broken(a, b, shape):
        raise ValueError("no field today")
    monkeypatch.setattr(server.render_api.flow, "packed_between", broken)
    with painting.websocket_connect("ws://127.0.0.1:7860/ws") as ws:
        picture(ws, flow=True)
        field, timing = picture(ws, flow=True)
        assert field is None and "ms" in timing


def test_the_estimate_runs_in_a_process_of_its_own(painting, server, monkeypatch):
    monkeypatch.setitem(server.render_api.flow_process, "use", True)
    monkeypatch.setitem(server.render_api.flow_process, "pool", None)
    try:
        with painting.websocket_connect("ws://127.0.0.1:7860/ws") as ws:
            picture(ws, flow=True)
            vectors, confidence = flow.unpack(picture(ws, flow=True)[0])
            assert confidence > 0.5 and abs(float(np.median(vectors[4:-4, 6:-6, 0])) * 512 - 8) < 2.5
        pool = server.render_api.flow_process["pool"]
        assert pool is not None and server.render_api.flow_process["use"], "the process was used, not the thread"
        # the process dies: the next field comes from the renderer's own thread, the pictures go on
        for p in list(pool._processes.values()):
            p.kill()
            p.join(5)
        with painting.websocket_connect("ws://127.0.0.1:7860/ws") as ws:
            picture(ws, flow=True)
            assert picture(ws, flow=True)[0] is not None
        assert server.render_api.flow_process["use"] is False
    finally:
        pool = server.render_api.flow_process["pool"]
        if pool is not None:
            pool.shutdown(wait=True, cancel_futures=True)


# ---------- the outputs: the stage's word about the next picture ----------
def announcement(n: int, field: np.ndarray | None, k: float = 1.0) -> str:
    m: dict = {"morph": None, "n": n}
    if field is not None:
        rows, cols = field.shape[:2]
        m["flow"] = {"cols": cols, "rows": rows, "k": k, "data": base64.b64encode(flow.pack(field, 1.0)[8:]).decode()}
    return json.dumps(m)


def test_the_syphon_source_takes_the_field_only_for_the_picture_that_follows(server, monkeypatch):
    monkeypatch.setattr(server.output, "syphon_sync", lambda: None)        # no Syphon thread
    monkeypatch.setitem(server.hub.state, "syphon", True)
    monkeypatch.setitem(server.hub.state, "master", 1.0)
    monkeypatch.setitem(server.output.shown, "frame", None)                # put back afterwards: the last picture shown
    syph = server.output.syph
    monkeypatch.setitem(syph, "cur", None)
    monkeypatch.setitem(syph, "prev", None)
    monkeypatch.setitem(syph, "field", None)
    monkeypatch.setitem(syph, "n", 0)
    field = np.zeros((27, 48, 2), dtype=np.float32)
    field[..., 0] = 0.03
    local = TestClient(server.app, base_url="http://127.0.0.1:7860", client=("127.0.0.1", 50001))
    with local.websocket_connect("ws://127.0.0.1:7860/out") as out, local.websocket_connect("ws://127.0.0.1:7860/view") as view:
        def show(text):
            before = syph["cur"]
            out.send_text(text)
            out.send_bytes(jpeg())
            while not view.receive().get("bytes"):     # the window gets the word, then the picture
                pass
            for _ in range(400):                       # the Syphon source decodes it beside the event loop
                if syph["cur"] is not before:
                    return syph["field"]
                time.sleep(0.005)
            raise AssertionError("the picture never reached the Syphon source")
        assert show(announcement(1, None)) is None
        got = show(announcement(2, field, 0.5))
        assert got is not None and got[1] == 0.5 and np.allclose(got[0], field, atol=1 / flow.UNIT)
        assert syph["cur"].shape == (36, 64, 4) and syph["cur"].dtype == np.uint8
        assert show(announcement(4, field)) is None            # picture 3 never came: no field for this pair
        assert show(announcement(5, field)) is not None
        assert show('{"morph": null, "n": 6, "flow": {"cols": 48, "rows": 27, "k": 1, "data": "AAAA"}}') is None   # not a field
        assert show(json.dumps({"morph": None})) is None       # an older stage: no number, no field
