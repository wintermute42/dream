"""Rights (#148, #156, #175): every role against every route of the app (rights.py), the origin/host check, the /ctl filter and the
guests' message allowance. The server runs with --lan in the test sandbox; the requests come from invented home-network
addresses."""
import json
import time

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

BASE = "http://127.0.0.1:7860"
ROLES = ("local", "control", "guest", "eyes", "window", "none")
A = set(ROLES)
LC = {"local", "control"}
LCG = {"local", "control", "guest"}
LCGE = {"local", "control", "guest", "eyes"}
LCGEW = LCGE | {"window"}                               # #201: the dream windows look, nothing more

# (method, route path) → (a concrete path, the roles that get past the guard). Written down by hand on purpose: a change
# of the rules (or a new route) has to change this table too.
HTTP = {
    ("GET", "/openapi.json"): ("/openapi.json", LC),
    ("GET", "/docs"): ("/docs", LC),
    ("GET", "/docs/oauth2-redirect"): ("/docs/oauth2-redirect", LC),
    ("GET", "/redoc"): ("/redoc", LC),
    ("GET", "/health"): ("/health", LCG),
    ("GET", "/stats"): ("/stats", LC),
    ("GET", "/static"): ("/static/remote.html", LCGEW),
    ("GET", "/"): ("/", LC),
    ("GET", "/energy_words"): ("/energy_words", LC),
    ("POST", "/voice"): ("/voice", LC),
    ("GET", "/cloud"): ("/cloud", LC),
    ("GET", "/measure"): ("/measure", LC),
    ("POST", "/measure"): ("/measure", LC),
    ("POST", "/cloud/start"): ("/cloud/start", LC),
    ("POST", "/cloud/stop"): ("/cloud/stop", LC),
    ("GET", "/mp/{name:path}"): ("/mp/wasm/vision_wasm_internal.js", LCGE),
    ("GET", "/eyes/mask/{name}"): ("/eyes/mask/0123456789ab.jpg", {"local", "control", "eyes", "window"}),
    ("GET", "/output"): ("/output", LCG),
    ("GET", "/playlists/{name}"): ("/playlists/Calm", LC),
    ("POST", "/playlists"): ("/playlists", LC),
    ("DELETE", "/playlists/{name}"): ("/playlists/Calm", LC),
    ("POST", "/playlists/generate"): ("/playlists/generate", LC),
    ("GET", "/remote"): ("/remote", LCG),
    ("GET", "/eyes"): ("/eyes", {"local", "control", "eyes"}),
    ("GET", "/window"): ("/window", {"local", "control", "window"}),
    ("GET", "/control"): ("/control", LC),
    ("GET", "/dream-ca.crt"): ("/dream-ca.crt", A),
    ("GET", "/remote-info"): ("/remote-info", LCG),
    ("GET", "/qr.svg"): ("/qr.svg", LC),
    ("POST", "/upload"): ("/upload", LC),
    ("POST", "/gallery"): ("/gallery", {"local"}),
    ("POST", "/gallery/{gid}/use"): ("/gallery/a1b2c3/use", LCG),
    ("POST", "/gallery/{gid}/delete"): ("/gallery/a1b2c3/delete", LC),
    ("POST", "/gallery/clear"): ("/gallery/clear", LC),
    ("POST", "/gallery/undo/{batch}"): ("/gallery/undo/b1", LC),
    ("POST", "/gallery/{gid}/save"): ("/gallery/a1b2c3/save", LC),
    ("POST", "/style-ref"): ("/style-ref", LC),
    ("GET", "/style-ref/{h}"): ("/style-ref/0123456789ab", LCG),
    ("GET", "/media/{name}"): ("/media/picture.jpg", LCG),
}
# more requests that are not a route of their own: public files, unknown paths (closed to guests and the eyes)
EXTRA = [
    ("GET", "/static/remote.webmanifest", A),
    ("GET", "/static/control.webmanifest", A),
    ("GET", "/static/icons/remote-192.png", A),
    ("GET", "/static/index.html", LCGEW),
    ("GET", "/eyes/mask/not-a-mask.jpg", LC),
    ("GET", "/no-such-page", LC),
    ("POST", "/no-such-action", LC),
    ("POST", "/health", LC),
    ("PUT", "/playlists/Calm", LC),
]
WS = {"/ws": LC, "/make": LC, "/ctl": LCGE, "/out": {"local"}, "/view": LCGEW}
# what each role may do (rights.ROLES), written down by hand too: the pages are told it with their role
CAN = {
    "local": ["control", "ctl", "eyes", "faces", "feed", "render", "set:all", "stage", "state", "view"],
    "control": ["control", "ctl", "eyes", "faces", "feed", "pair_eyes", "render", "set:all", "state", "take_over", "view"],
    "guest": ["ctl", "set:guest", "state", "view"],
    "eyes": ["ctl", "eyes", "eyes_only", "faces", "feed", "view"],
    "window": ["faces", "view"],
}


def client(server, role: str, scheme: str = "http", host: str = "192.168.1.30", **kw) -> TestClient:
    """A device with this role: this Mac (no key), or a phone in the home network with its key in the address."""
    if role == "local":
        return TestClient(server.app, base_url=f"{scheme}://127.0.0.1:7860", client=("127.0.0.1", 50001), **kw)
    return TestClient(server.app, base_url=f"{scheme}://192.168.1.20:7860", client=(host, 50002), **kw)


def key_of(server, role: str) -> dict:
    if role in ("local", "none"):
        return {} if role == "local" else {"k": "not-a-key"}
    return {"k": server.rights.keys[role]}


@pytest.fixture
def reached(server, monkeypatch):
    """Everything past the guard ends here instead of in a handler: no handler runs (no cloud, no files, no model)."""
    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
        await send({"type": "http.response.body", "body": b"reached"})
    monkeypatch.setattr(server.app, "router", inner)
    monkeypatch.setattr(server.app, "middleware_stack", None)
    return inner


def test_every_route_is_in_the_table(server):
    """A new route must be classified here (and in the rules of rights.py) before it ships."""
    http, ws = set(), set()
    for r in server.app.routes:
        if type(r).__name__ == "Mount":
            http.add(("GET", r.path))
        elif hasattr(r, "methods") and r.methods is not None:
            http |= {(m, r.path) for m in r.methods if m != "HEAD"}
        else:
            ws.add(r.path)
    assert http == set(HTTP)
    assert ws == set(WS)


CASES = [(m, p, want) for (m, _), (p, want) in HTTP.items()] + EXTRA


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("method,path,want", CASES, ids=[f"{m} {p}" for m, p, _ in CASES])
def test_http_rights(server, reached, role, method, path, want):
    r = client(server, role).request(method, path, params=key_of(server, role))
    if role in want:
        assert (r.status_code, r.text) == (200, "reached"), f"{role} should reach {method} {path}"
    else:
        assert r.status_code == 403, f"{role} must not reach {method} {path}"
        assert r.text != "reached"


@pytest.mark.parametrize("role", ["control", "guest", "eyes", "window"])
def test_key_in_a_cookie(server, reached, role):
    """A paired device brings its key as a cookie: dream_k over http, dream_c over https, dream_e for the eyes,
    dream_w for a dream window (#201)."""
    path = {"control": "/stats", "guest": "/remote", "eyes": "/eyes", "window": "/window"}[role]
    name = {"control": "dream_c", "guest": "dream_k", "eyes": "dream_e", "window": "dream_w"}[role]
    scheme = "https" if role == "control" else "http"
    c = client(server, role, scheme=scheme, cookies={name: server.rights.keys[role]})
    assert c.get(path).text == "reached"
    assert client(server, role, cookies={name: "stolen"}).get(path).status_code == 403


def test_key_from_the_address_is_kept_as_a_cookie(server, reached):
    r = client(server, "guest").get("/remote", params={"k": server.rights.keys["guest"]})
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"dream_k={server.rights.keys['guest']}") and "HttpOnly" in cookie and "SameSite=lax" in cookie


@pytest.mark.parametrize("role,path,name", [("window", "/window", "dream_w"), ("eyes", "/eyes", "dream_e"),
                                            ("guest", "/remote", "dream_k")])
def test_a_page_renews_only_the_cookie_it_signed_in_with(server, reached, role, path, name):
    """#170: a key that works is renewed on every page. A device that keeps several valid keys gets back the one this
    page signed in with – a dream window its dream_w (#201), the eyes' page its dream_e (#166) – and no other."""
    kept = {"dream_k": server.rights.keys["guest"], "dream_e": server.rights.keys["eyes"],
            "dream_w": server.rights.keys["window"]}
    r = client(server, role, cookies=kept).get(path, headers={"accept": "text/html"})
    assert r.text == "reached"
    renewed = r.headers.get_list("set-cookie")
    assert len(renewed) == 1, renewed
    assert renewed[0].startswith(f"{name}={kept[name]};") and "HttpOnly" in renewed[0] and "SameSite=lax" in renewed[0]


def test_a_device_without_a_key_gets_the_pairing_page(server):
    r = client(server, "none").get("/remote", headers={"accept": "text/html"})
    assert r.status_code == 403 and "<html" in r.text.lower() and server.rights.keys["guest"] not in r.text


def test_without_lan_only_this_mac(server, reached, monkeypatch):
    monkeypatch.setattr(server.config, "LAN", False)
    assert client(server, "control").get("/stats", params=key_of(server, "control")).status_code == 403
    assert client(server, "local").get("/stats").text == "reached"


def test_role_of(server):
    k = server.rights.keys
    assert server.rights.role_of("127.0.0.1", None, None) == "local"
    assert server.rights.role_of("::1", "wrong", None) == "local"
    assert server.rights.role_of("192.168.1.30", k["control"], None) == "control"
    assert server.rights.role_of("192.168.1.30", None, k["guest"]) == "guest"
    assert server.rights.role_of("192.168.1.30", k["eyes"], k["control"]) == "eyes"      # the address wins over the cookie
    assert server.rights.role_of("192.168.1.30", k["window"], None) == "window"          # #201
    assert server.rights.role_of("192.168.1.30", None, None) is None
    assert server.rights.role_of("192.168.1.30", "", "") is None
    assert server.rights.role_of("192.168.1.30", k["guest"] + "x", None) is None


def test_roles_table_is_pinned(server):
    """Changing what a role may do is a decision: this table changes only with it (#189)."""
    table = server.rights.ROLES
    assert {name: sorted(r.can) for name, r in table.items()} == CAN
    assert set(table) | {"none"} == set(ROLES)
    for name, r in table.items():
        assert r.can <= set(server.rights.CAPABILITIES)
        assert (r.key is None) == (name == "local")           # every role but this Mac comes with a key
    assert len(set(server.rights.keys.values())) == 4
    assert not any(server.rights.can(None, c) or server.rights.can("stranger", c) for c in server.rights.CAPABILITIES)
    assert (table["guest"].http, table["eyes"].cookie, table["window"].cookie) == (server.rights.GUEST_HTTP, "dream_e", "dream_w")
    assert table["eyes"].pairs and table["window"].pairs and not table["guest"].pairs


def test_rights_load_without_torch(tmp_path):
    """The rights and the settings can be read and checked where no model library is installed (#189)."""
    import os
    import subprocess
    import sys
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    code = ("import sys; sys.modules['torch'] = None; import rights, settings; "
            "assert rights.can('guest', 'set:guest') and not rights.can('guest', 'render'); "
            "assert rights.role_of('127.0.0.1', None, None) == 'local'; print(sorted(rights.keys))")
    env = {**os.environ, "HOME": str(tmp_path), "DREAM_STATE_DIR": str(tmp_path / "state"), "DREAM_LAN": "1"}
    out = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, timeout=60, env=env)
    assert out.returncode == 0, out.stderr
    assert out.stdout.split() == ["['control',", "'eyes',", "'guest',", "'window']"]


def test_needs(server):
    assert server.rights.needs("POST", "/gallery") == {"local"}
    assert server.rights.needs("POST", "/cloud/start") == {"local", "control"}
    assert server.rights.needs("POST", "/cloud/start/") is None          # fullmatch: the route itself does not exist
    assert server.rights.needs("GET", "/health") is None


def test_cookie_of(server):
    both = {"dream_k": "guest-key", "dream_c": "control-key", "dream_e": "eyes-key"}
    assert server.rights.cookie_of(both, "http") == "guest-key"
    assert server.rights.cookie_of(both, "https") == "control-key"
    assert server.rights.cookie_of(both, "wss") == "control-key"
    assert server.rights.cookie_of(both, "https", eyes=True) == "eyes-key"   # #166: the eyes' page asks for the eyes' key first
    assert server.rights.cookie_of({"dream_e": "eyes-key"}, "http") == "eyes-key"
    assert server.rights.cookie_of({**both, "dream_w": "window-key"}, "http", window=True) == "window-key"   # #201
    assert server.rights.cookie_of({}, "http") is None


# ---------- origin and host (#175): DNS rebinding and foreign pages ----------
@pytest.mark.parametrize("host,origin,ok", [
    ("127.0.0.1:7860", None, True),
    ("localhost:7860", None, True),
    ("[::1]:7860", None, True),
    ("192.168.1.20:7860", None, True),
    ("dream-mac.local:7860", None, True),
    ("DREAM-MAC.LOCAL:7443", None, True),
    ("192.168.1.20:7860", "http://192.168.1.20:7860", True),
    ("127.0.0.1:7860", "http://127.0.0.1:7860/", True),
    ("dream-mac.local:7443", "https://dream-mac.local:7443", True),
    ("evil.example:7860", None, False),                 # DNS rebinding: a foreign name pointing at this Mac
    ("evil.example", None, False),
    ("127.0.0.1.evil.example:7860", None, False),
    ("local:7860", None, False),
    ("", None, False),
    ("127.0.0.1:7860", "http://evil.example", False),   # a foreign page in a browser on this Mac
    ("127.0.0.1:7860", "http://127.0.0.1:9999", False),
    ("127.0.0.1:7860", "null", False),
    ("192.168.1.20:7860", "http://192.168.1.21:7860", False),
])
def test_origin_ok(server, host, origin, ok):
    headers = {"host": host, **({"origin": origin} if origin is not None else {})}
    assert server.rights.origin_ok(headers) is ok


def test_foreign_host_or_origin_is_refused_before_anything(server, reached):
    local = client(server, "local")
    assert local.get("/health").text == "reached"
    assert local.get("/health", headers={"host": "evil.example:7860"}).status_code == 403
    assert local.post("/cloud/start", headers={"origin": "http://evil.example"}).status_code == 403
    assert local.get("/dream-ca.crt", headers={"host": "evil.example"}).status_code == 403   # also the public files
    assert local.get("/health", headers={"origin": BASE}).text == "reached"


# ---------- WebSockets ----------
def ws_url(server, path: str, role: str) -> str:
    q = key_of(server, role)
    host = "127.0.0.1" if role == "local" else "192.168.1.20"
    return f"ws://{host}:7860{path}" + (f"?k={q['k']}" if q else "")


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("path", sorted(WS))
def test_ws_rights(server, role, path):
    c = client(server, role)
    if role in WS[path]:
        with c.websocket_connect(ws_url(server, path, role)):
            pass
    else:
        with pytest.raises(WebSocketDisconnect) as e:
            with c.websocket_connect(ws_url(server, path, role)):
                pass
        assert e.value.code == 4403


def test_ws_foreign_origin(server):
    with pytest.raises(WebSocketDisconnect) as e:
        with client(server, "local").websocket_connect(ws_url(server, "/ctl", "local"),
                                                       headers={"origin": "http://evil.example"}):
            pass
    assert e.value.code == 4403


@pytest.fixture(autouse=True)
def no_ghost_sockets(server):
    """The test client cancels a socket's handler right after it closes, maybe while it still greets: no session
    leaves its registration behind for the next test."""
    yield
    for d in (server.hub.clients, server.hub.roles, server.hub.key_roles):
        d.clear()
    server.eyes.eyes_pages.clear()
    server.hub.viewers.clear()
    server.hub.previews.clear()


@pytest.fixture
def saved_state(server):
    before = dict(server.hub.state)
    yield server.hub.state
    server.hub.state.clear()
    server.hub.state.update(before)
    server.hub.save_state()


def wait_until(cond, secs: float = 5.0) -> None:
    end = time.monotonic() + secs
    while not cond():
        assert time.monotonic() < end, "the server did not get there in time"
        time.sleep(0.01)


def ctl_session(server, role: str, messages: list, done) -> dict:
    """Opens /ctl with this role, sends the messages, waits until done() and closes; returns the role message."""
    with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
        first = ws.receive_json()
        for m in messages:
            ws.send_text(json.dumps(m))
        wait_until(done)
    return first


def test_ctl_guest_changes_only_guest_keys(server, saved_state):
    server.hub.state.update(running=True, backend="local", mode="dream", quality=2)
    first = ctl_session(server, "guest", [{"set": {"prompt": "a quiet lake at dawn", "backend": "cloud", "running": False,
                                                    "quality": 4, "mode": "cam", "zoom": 0.02}},
                                           {"set": {"mode": "img"}}],
                        done=lambda: server.hub.state["mode"] == "img")
    assert first == {"role": "guest", "can_take": False, "can": CAN["guest"]}
    s = server.hub.state
    assert (s["prompt"], s["zoom"], s["mode"]) == ("a quiet lake at dawn", 0.02, "img")
    assert (s["backend"], s["running"], s["quality"]) == ("local", True, 2)


def test_ctl_guest_commands(server, monkeypatch, saved_state):
    sent = []

    async def broadcast(msg, exclude=None, only=None):
        sent.append(msg)
    monkeypatch.setattr(server.hub, "broadcast", broadcast)
    renewed = []
    monkeypatch.setattr(server.ctl, "renew_guest", lambda: renewed.append(1))
    ctl_session(server, "guest", [{"cmd": "restart"}, {"renew_guest": True}, {"midi_forget": "c1:cc7"},
                                  {"midi_learn": "strength"}, {"cmd": "tap"}],
                done=lambda: any(m.get("cmd") == "tap" for m in sent))
    assert [m["cmd"] for m in sent if "cmd" in m] == ["tap"]
    assert not any("midi" in m for m in sent) and not renewed and not server.inputs.midi_learn


def test_ctl_eyes_change_nothing(server, monkeypatch, saved_state):
    server.hub.state["prompt"] = "unchanged"
    noted = []
    monkeypatch.setattr(server.eyes, "eyes_note", noted.append)
    first = ctl_session(server, "eyes", [{"set": {"prompt": "taken over"}, "cmd": "restart"}, {"take_control": True},
                                         {"done": 1}],
                        done=lambda: {"done": 1} in noted)
    assert first["role"] == "eyes"
    assert server.hub.state["prompt"] == "unchanged"


def test_ctl_control_changes_everything(server, saved_state):
    server.hub.state.update(running=True, quality=2)
    first = ctl_session(server, "control", [{"set": {"running": False, "quality": 3}}],
                        done=lambda: server.hub.state["quality"] == 3)
    assert first == {"role": "control", "can_take": False, "can": CAN["control"]}
    assert server.hub.state["running"] is False


def test_ctl_poisoned_numbers_are_not_taken(server, saved_state):
    server.hub.state.update(strength=0.5, prompt="before")
    ctl_session(server, "control", [{"set": {"strength": "NaN", "zoom": 1e400, "seed": "1e999", "hue": float("inf")}},
                                    {"set": {"prompt": "after"}}],
                done=lambda: server.hub.state["prompt"] == "after")
    assert (server.hub.state["strength"], server.hub.state["zoom"]) == (0.5, saved_state["zoom"])
    assert json.load(open(server.hub.STATE_FILE))["strength"] == 0.5


def test_ctl_second_control_is_a_guest_until_it_takes_over(server):
    c = client(server, "control")
    url = ws_url(server, "/ctl", "control")
    with c.websocket_connect(url) as one:
        assert one.receive_json()["role"] == "control"
        with c.websocket_connect(url) as two:
            assert two.receive_json() == {"role": "guest", "can_take": True, "can": CAN["guest"]}
            two.send_text(json.dumps({"take_control": True}))
            assert next_with(two, "role") == {"role": "control", "can_take": False, "can": CAN["control"]}
            assert next_with(one, "taken") == {"role": "guest", "can_take": True, "can": CAN["guest"], "taken": True}


def next_with(ws, key: str) -> dict:
    """The next message that has this key (the greeting and status messages in between are skipped)."""
    for _ in range(50):
        msg = ws.receive_json()
        if key in msg:
            return msg
    raise AssertionError(f"no message with {key!r}")


def test_ctl_guest_allowance(server, monkeypatch, saved_state):
    """#175: a guest gets about 20 messages a second; the rest is dropped."""
    taken = []
    apply = server.hub.apply

    async def counting(changes, **kw):
        taken.append(changes)
        await apply(changes, **kw)
    monkeypatch.setattr(server.hub, "apply", counting)
    monkeypatch.setattr(server.hub, "save_state", lambda: None)
    burst = [{"set": {"seed": i}} for i in range(1, 101)]
    ctl_session(server, "guest", burst + [{"done": 1}], done=lambda: len(taken) >= 20)
    time.sleep(0.2)
    assert 20 <= len(taken) <= 40


def test_render_allowed_only_for_the_stage_side(server):
    class Sock:
        def __init__(self, host, k=None):
            self.headers = {"host": "192.168.1.20:7860"}
            self.client = type("C", (), {"host": host})()
            self.query_params = {"k": k} if k else {}
            self.cookies = {}
            self.url = type("U", (), {"scheme": "ws"})()
    k = server.rights.keys
    assert server.rights.ws_can(Sock("127.0.0.1"), "render")
    assert server.rights.ws_can(Sock("192.168.1.30", k["control"]), "render")
    assert not server.rights.ws_can(Sock("192.168.1.30", k["guest"]), "render")
    assert not server.rights.ws_can(Sock("192.168.1.30", k["eyes"]), "render")
    assert not server.rights.ws_can(Sock("192.168.1.30"), "render")


# ---------- dream windows (#201): any number, one organism over all of them, they only look ----------
def test_dream_windows_get_seeds_and_cannot_steer(server):
    k = server.rights.keys["window"]
    c = client(server, "window")
    with c.websocket_connect(f"ws://192.168.1.20:7860/view?as=window&k={k}") as a, \
            c.websocket_connect(f"ws://192.168.1.20:7860/view?as=window&k={k}") as b:
        def first(ws, key):
            for _ in range(20):
                m = json.loads(ws.receive_text())
                if key in m:
                    return m[key]
        assert {first(a, "window")["index"], first(b, "window")["index"]} <= {0, 1}
    with pytest.raises(WebSocketDisconnect):                           # a window may not open /ctl
        with c.websocket_connect(f"ws://192.168.1.20:7860/ctl?role=remote&k={k}") as w:
            w.receive_text()


def test_window_seeds_wander_from_window_to_window(server, monkeypatch):
    """A wanderer that leaves one window comes into the next one from the other side – the same being."""
    import asyncio
    sent = []

    class Sock:
        def __init__(self, n): self.n = n
        async def send_text(self, text): sent.append((self.n, json.loads(text)))
    one, two = Sock(1), Sock(2)
    ws, wd = server.hub.windows, server.windows.wanderers
    ws.clear(); ws.update({one: {"next": 0}, two: {"next": 1e12}}); wd.clear()
    monkeypatch.setattr(server.windows.random, "random", lambda: 0.0)          # a wanderer, surely
    asyncio.run(server.windows.windows_tick(100.0))
    seed = next(m["life"] for n, m in sent if n == 1)
    assert seed["kind"] in server.windows.WANDER_KINDS and seed["exit"] != "in"
    sent.clear()
    asyncio.run(server.windows.windows_tick(100.0 + seed["life"] + 0.1))
    nxt = next(m["life"] for n, m in sent if n == 2)
    assert nxt["seed"] == seed["seed"] and nxt["kind"] == seed["kind"]
    assert nxt["enter"] == {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}[seed["exit"]]
    ws.clear(); wd.clear()


def test_window_seeds_are_only_what_a_window_needs(server):
    """A seed carries no prompt, no setting, no picture – only what to draw."""
    for wander in (True, False):
        s = server.windows.window_seed("cloud", wander, "left" if wander else "in")
        assert set(s) == {"id", "kind", "variant", "seed", "life", "enter", "exit", "hue", "size"}
