"""Running smoothly (#187): the prompt is encoded once per prompt (SDXL too), a loading model does not stop pictures with
outlines or pose, the state file is written once the hands rest, no device waits for a slow one, and remotes and
Dreamy Eyes get a small preview. No model: stand-ins for the pipelines, the sockets and the clock."""
import asyncio
import contextlib
import io
import json
import threading
import types

import pytest
from PIL import Image
from starlette.testclient import TestClient

import outbox


# ---------- Pf-1: the prompt is encoded once per prompt, the blend works for every model ----------
class Vec(list):
    """A stand-in for a tensor: enough for the blend."""


class Pipe:
    def __init__(self):
        self.encoded, self.calls = [], []
        self.unet = self.vae = self.controlnet = types.SimpleNamespace()

    def encode_prompt(self, prompt=None, device=None, num_images_per_prompt=1, do_classifier_free_guidance=True):
        self.encoded.append(prompt)
        n = float(len(prompt))
        return (Vec([n, n]), None, Vec([n * 10]), None)

    def __call__(self, **kw):
        self.calls.append(kw)
        return types.SimpleNamespace(images=["picture"])


@pytest.fixture
def painting(server, monkeypatch):
    """server.py with stand-in pipelines for both models and just enough torch to paint with them."""
    monkeypatch.setattr(server.torch, "lerp", lambda a, b, t: Vec(x + (y - x) * t for x, y in zip(a, b)), raising=False)
    monkeypatch.setattr(server.torch, "Generator", lambda device=None: types.SimpleNamespace(manual_seed=lambda s: s),
                        raising=False)
    monkeypatch.setattr(server.torch, "no_grad", contextlib.nullcontext)
    monkeypatch.setattr(server.styles, "apply", lambda p, key, amt: None)
    monkeypatch.setattr(server.styles, "ip_args", lambda p, ref, amt: {})
    pipes = {"sd-turbo": Pipe(), "sdxl-turbo": Pipe()}
    for d in (server._pipes, server._ctl_pipes, server._embeds, server._cn_models):
        monkeypatch.setattr(server, {id(server._pipes): "_pipes", id(server._ctl_pipes): "_ctl_pipes",
                                     id(server._embeds): "_embeds", id(server._cn_models): "_cn_models"}[id(d)], {})
    server._pipes.update(pipes)
    monkeypatch.setitem(server.model_state, "loading", None)
    monkeypatch.setitem(server.model_state, "active", "sd-turbo")
    return pipes


def paint(server, key, prompt, **kw):
    return server._render_now(key, "input", prompt, 0.5, 2, 1, kw.pop("pose", None), 0.8, None, 0.0,
                              kw.pop("prompt2", None), kw.pop("pt", 0.0), **kw)


@pytest.mark.parametrize("key", ["sd-turbo", "sdxl-turbo"])
def test_prompt_is_encoded_once_per_prompt(server, painting, key):
    p = painting[key]
    for _ in range(5):
        assert paint(server, key, "a calm sea") == "picture"
    assert p.encoded == ["a calm sea"]
    assert all("prompt" not in c and "prompt_embeds" in c for c in p.calls)
    assert ("pooled_prompt_embeds" in p.calls[0]) is (key == "sdxl-turbo")   # SDXL needs the pooled one too
    paint(server, key, "a storm")
    assert p.encoded == ["a calm sea", "a storm"]


@pytest.mark.parametrize("key", ["sd-turbo", "sdxl-turbo"])
def test_prompts_blend(server, painting, key):
    p = painting[key]
    paint(server, key, "ab", prompt2="abcdef", pt=0.25)          # lengths 2 and 6: a quarter of the way is 3
    assert p.calls[-1]["prompt_embeds"] == [3.0, 3.0]
    if key == "sdxl-turbo":
        assert p.calls[-1]["pooled_prompt_embeds"] == [30.0]
    paint(server, key, "ab", prompt2="abcdef", pt=0.75)
    assert p.calls[-1]["prompt_embeds"] == [5.0, 5.0]
    assert sorted(p.encoded) == ["ab", "abcdef"]                 # both encoded once, however long the blend runs


def test_outlines_and_pose_use_the_cached_prompt(server, painting, monkeypatch):
    monkeypatch.setattr(server, "edge_map", lambda img: "edges")
    for key in ("sd-turbo", "sdxl-turbo"):
        base, pp = painting[key], Pipe()
        server._ctl_pipes[(key, ("edges",))] = pp
        for _ in range(3):
            paint(server, key, "a calm sea", edges=0.6)
        assert base.encoded == ["a calm sea"] and pp.encoded == []
        assert len(pp.calls) == 3 and "prompt" not in pp.calls[0] and pp.calls[0]["control_image"] == "edges"
        assert ("pooled_prompt_embeds" in pp.calls[0]) is (key == "sdxl-turbo")


def test_sdxl_prompt_cache_follows_the_style(server, painting, monkeypatch):
    """A style model changes SDXL's text encoders: another style or amount is another encoding."""
    p = painting["sdxl-turbo"]
    paint(server, "sdxl-turbo", "a calm sea")
    monkeypatch.setitem(server.styles.state, "key", "watercolour")
    monkeypatch.setitem(server.styles.state, "amt", 0.8)
    paint(server, "sdxl-turbo", "a calm sea")
    paint(server, "sdxl-turbo", "a calm sea")
    assert p.encoded == ["a calm sea", "a calm sea"]


def test_prompt_cache_is_small_and_freed_with_its_model(server, painting, monkeypatch):
    for i in range(20):
        paint(server, "sdxl-turbo", f"prompt {i}")
    paint(server, "sd-turbo", "a calm sea")
    assert len(server._embeds) <= 8
    monkeypatch.setattr(server, "_free_memory", lambda: None)
    monkeypatch.setattr(server.styles, "forget", lambda: None)
    server.release("sdxl-turbo")
    assert [k[0] for k in server._embeds] == ["sd-turbo"]


# ---------- Pf-2: a model that loads in the background does not stop pictures with outlines or pose ----------
def in_time(f, secs=2.0):
    """Runs f in a thread; its result, or "blocked" if it does not come back."""
    out = ["blocked"]
    t = threading.Thread(target=lambda: out.__setitem__(0, f()), daemon=True)
    t.start()
    t.join(secs)
    return out[0]


def test_loading_model_does_not_block_outlines(server, painting, monkeypatch):
    built = Pipe()
    server._ctl_pipes[("sd-turbo", ("edges",))] = built
    monkeypatch.setattr(server, "_render", lambda key, *a, **k: f"painted with {key}")
    monkeypatch.setitem(server.model_state, "loading", "sdxl-turbo")
    with server._load_lock:                                        # as while the next model loads
        assert in_time(lambda: server.control_pipeline("sd-turbo", ("edges",))) is built
        assert in_time(lambda: server.dream("sdxl-turbo", "img", "a calm sea", 0.5, 2, 1, edges=0.6)) == \
            ("painted with sd-turbo", "sd-turbo")


def test_model_paints_only_after_its_warm_up(server, painting, monkeypatch):
    """A model is in _pipes while it still warms up (and, in the cloud, compiles): the stage stays with the old one."""
    monkeypatch.setitem(server.model_state, "loading", "sdxl-turbo")
    with server._load_lock:
        assert in_time(lambda: server.use_model("sdxl-turbo")) == "sd-turbo"
    monkeypatch.setitem(server.model_state, "loading", None)
    monkeypatch.setattr(server, "_drop_others", lambda keep: None)
    assert server.use_model("sdxl-turbo") == "sdxl-turbo" and server.model_state["active"] == "sdxl-turbo"


def test_picture_generator_does_not_wait_for_a_loading_model(server, painting, monkeypatch):
    server._t2i["sd-turbo"], server._full_vae["sd-turbo"] = "maker", None
    monkeypatch.setitem(server.model_state, "loading", "sdxl-turbo")
    try:
        with server._load_lock:
            assert in_time(lambda: server._maker("sd-turbo")) == "maker"
    finally:
        server._t2i.pop("sd-turbo", None), server._full_vae.pop("sd-turbo", None)


# ---------- Pf-5: the state file is written once the hands rest ----------
@pytest.fixture
def saves(server, monkeypatch):
    n = []
    before = dict(server.state)
    monkeypatch.setattr(server, "save_state", lambda: n.append(dict(server.state)))
    monkeypatch.setattr(server, "SAVE_AFTER", 0.05)
    monkeypatch.setattr(server, "SAVE_LATEST", 0.3)
    monkeypatch.setitem(server.saving, "timer", None)
    yield n
    server.state.clear()
    server.state.update(before)
    server.saving["timer"] = None


def test_dragging_a_slider_writes_the_state_once(server, saves):
    async def drag():
        for i in range(30):
            await server.apply({"strength": 0.2 + i / 100})
        assert saves == []                                         # nothing written while the hand moves
        await asyncio.sleep(0.15)
    asyncio.run(drag())
    assert len(saves) == 1 and saves[0]["strength"] == pytest.approx(0.49)


def test_a_long_drag_is_saved_meanwhile(server, saves):
    async def drag():
        for i in range(30):                                        # 0.6 s without a rest of 0.05 s
            await server.apply({"strength": 0.2 + i / 100})
            await asyncio.sleep(0.02)
        return len(saves)
    assert asyncio.run(drag()) >= 1


def test_stopping_dream_writes_what_was_put_off(server, saves):
    async def change_and_stop():
        await server.apply({"prompt": "a quiet lake at dawn"})
        assert saves == []
        server.save_now()                                          # the shutdown hook
        server.save_now()                                          # nothing left: no second write
    asyncio.run(change_and_stop())
    assert len(saves) == 1 and saves[0]["prompt"] == "a quiet lake at dawn"
    assert server.save_now in server.app.router.on_shutdown


# ---------- Pf-5: nobody waits for a slow device ----------
class Device:
    """A stand-in for a WebSocket; a slow one takes nothing until it is let go."""
    def __init__(self, slow=False):
        self.got, self.closed, self.slow = [], None, slow
        self.go = None

    async def _line(self):
        if self.slow:
            self.go = self.go or asyncio.Event()
            await self.go.wait()

    async def send_text(self, text):
        await self._line()
        self.got.append(text)

    async def send_bytes(self, data):
        await self._line()
        self.got.append(data)

    async def close(self, code=1000):
        self.closed = code


@pytest.fixture
def devices(server):
    made = []

    def make(kind="remote", slow=False):
        d = Device(slow)
        server.clients[d] = kind
        made.append(d)
        return d
    yield make
    for d in made:
        server.clients.pop(d, None)
        outbox._boxes.pop(d, None)


def test_slow_device_does_not_hold_up_the_others(server, devices):
    slow, fast = devices(slow=True), devices()

    async def run():
        for i in range(50):
            await asyncio.wait_for(server.broadcast({"set": {"seed": i}}), 0.5)   # waited for the slow one before
        await asyncio.sleep(0.05)
        assert len(fast.got) == 50 and slow.got == []
        slow.go.set()                                              # its line moves again: it gets all of it, in order
        await outbox.flush()
    asyncio.run(run())
    assert [json.loads(t)["set"]["seed"] for t in slow.got] == list(range(50)) == [json.loads(t)["set"]["seed"] for t in fast.got]


def test_pictures_for_a_slow_device_latest_wins(server, devices):
    slow = devices(slow=True)

    async def run():
        outbox.post(slow, "before")
        for i in range(10):
            outbox.post_frame(slow, bytes([i]))
        outbox.post(slow, "after")
        await asyncio.sleep(0.01)
        slow.go.set()
        await outbox.flush()
        return outbox.box(slow).dropped
    assert asyncio.run(run()) == 9
    assert slow.got == ["before", bytes([9]), "after"]             # messages all and in order, one picture: the newest


def test_camera_pictures_for_the_stage_are_not_waited_for(server, devices, monkeypatch):
    stage, phone = devices("stage", slow=True), devices()
    monkeypatch.setitem(server.feeds, "cam", phone)

    async def run():
        for i in range(20):
            await asyncio.wait_for(server.feed_frame(phone, b"\xff\xd8" + bytes([i])), 0.5)
        await asyncio.sleep(0.01)
        stage.go.set()
        await outbox.flush()
    asyncio.run(run())
    assert stage.got[-1] == b"\xff\xd8" + bytes([19]) and len(stage.got) <= 2


def test_stalled_device_is_disconnected_not_silently_skipped(server, devices, monkeypatch):
    monkeypatch.setattr(outbox, "STALL", 0.05)
    slow, fast = devices(slow=True), devices()

    async def run():
        await server.broadcast({"set": {"seed": 0}})
        await asyncio.sleep(0.1)                                   # the slow one's line has not moved for too long
        await server.broadcast({"set": {"seed": 1}})
        await asyncio.sleep(0.01)
        assert slow.closed == 1013 and slow not in server.clients   # its page connects again and gets the whole state
        assert fast.closed is None and len(fast.got) == 2
        assert outbox.post(slow, "more") is False
    asyncio.run(run())
    assert slow.got == []


def test_burst_does_not_disconnect_a_fast_device(server, devices):
    """Many messages in one go (no pause in which anything could be sent) are not a slow device."""
    fast = devices()

    async def run():
        for i in range(600):
            await server.broadcast({"set": {"seed": i}})
        await outbox.flush()
    asyncio.run(run())
    assert fast.closed is None and len(fast.got) == 600


def test_queue_of_a_device_is_bounded(server, devices):
    slow = devices(slow=True)

    async def run():
        for i in range(outbox.LIMIT + 5):
            outbox.post(slow, "x")
        await asyncio.sleep(0.01)
        assert slow.closed == 1013 and len(outbox.box(slow).queue) == 0
    asyncio.run(run())


def test_broken_line_ends_the_queue(server, devices):
    class Gone(Device):
        async def send_text(self, text):
            raise RuntimeError("closed")
    gone = devices()
    gone.__class__ = Gone

    async def run():
        await server.broadcast({"set": {"seed": 1}})
        await asyncio.sleep(0.01)
        await server.broadcast({"set": {"seed": 2}})
    asyncio.run(run())
    assert gone not in server.clients


# ---------- Pf-7: remotes and Dreamy Eyes get a small preview ----------
def jpeg(w, h) -> bytes:
    buf = io.BytesIO()
    Image.effect_noise((w, h), 60).convert("RGB").save(buf, "JPEG", quality=90)
    return buf.getvalue()


def size_of(data: bytes):
    return Image.open(io.BytesIO(data)).size


@pytest.mark.parametrize("size, want", [((1024, 1024), (320, 320)), ((768, 432), (320, 180)), ((512, 512), (320, 320))])
def test_small_frame(server, size, want):
    big = jpeg(*size)
    small = server.small_frame(big)
    assert size_of(small) == want and len(small) < len(big) / 2


def test_small_frame_keeps_a_small_picture(server):
    data = jpeg(256, 256)
    assert server.small_frame(data) is data


@pytest.fixture
def no_ghosts(server):
    yield
    for d in (server.clients, server.roles, server.key_roles, server.previews):
        d.clear()
    server.viewers.clear()
    server.shown["frame"] = None
    server.preview.update(at=0.0, busy=False)


def binary(ws) -> bytes:
    for _ in range(20):
        m = ws.receive()
        if m.get("bytes"):
            return m["bytes"]
    raise AssertionError("no picture came")


def test_preview_is_small_and_the_output_window_gets_the_full_picture(server, no_ghosts, monkeypatch):
    monkeypatch.setattr(server, "PREVIEW_EVERY", 0.0)
    local = lambda: TestClient(server.app, base_url="http://127.0.0.1:7860", client=("127.0.0.1", 50000))   # noqa: E731
    stage_frame, next_frame = jpeg(768, 768), jpeg(768, 432)
    with local().websocket_connect("ws://127.0.0.1:7860/view?preview=1") as remote, \
            local().websocket_connect("ws://127.0.0.1:7860/view") as window, \
            local().websocket_connect("ws://127.0.0.1:7860/out") as out:
        out.send_bytes(stage_frame)
        assert size_of(binary(remote)) == (320, 320)
        assert binary(window) == stage_frame
        remote.send_text(json.dumps({"size": "full"}))             # shown large on the remote: the full picture
        assert binary(remote) == stage_frame
        remote.send_text(json.dumps({"size": "small"}))
        remote.send_text("not json")                               # ignored
        for _ in range(100):                                       # the server takes the wish in its own time
            if server.previews and "full" not in server.previews.values():
                break
            threading.Event().wait(0.01)
        out.send_bytes(next_frame)
        assert size_of(binary(remote)) == (320, 180)
        assert binary(window) == next_frame
    with local().websocket_connect("ws://127.0.0.1:7860/view?preview=1&as=eyes") as eyes:   # a late one: the last picture, small
        assert size_of(binary(eyes)) == (320, 180)
