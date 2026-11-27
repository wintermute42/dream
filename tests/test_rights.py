"""Rights (#148, #156, #175): every role against every route of the app (rights.py), the origin/host check, the /ctl filter and the
guests' message allowance. The server runs with --lan in the test sandbox; the requests come from invented home-network
addresses."""
import asyncio
import contextlib
import itertools
import json
import time
import types

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
    ("GET", "/dance"): ("/dance", {"local"}),            # #251: the page of Dream Dance is this Mac's
    ("GET", "/flowtrack"): ("/flowtrack", {"local"}),    # #252: … and so is the page of Flowtrack
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
    # #243: the dance lab's sessions – trajectories of the owner's dance: this Mac and Dream Control only
    ("GET", "/dance/sessions"): ("/dance/sessions", LC),
    ("POST", "/dance/sessions"): ("/dance/sessions", LC),
    ("GET", "/dance/sessions/{sid}"): ("/dance/sessions/20261124-120000-ab12", LC),
    ("DELETE", "/dance/sessions/{sid}"): ("/dance/sessions/20261124-120000-ab12", LC),
    ("POST", "/dance/sessions/{sid}/export"): ("/dance/sessions/20261124-120000-ab12/export", LC),
    # #236: the dance moves the dancer taught – trajectories too: this Mac and Dream Control only
    ("GET", "/dance/moves"): ("/dance/moves", LC),
    ("POST", "/dance/moves"): ("/dance/moves", LC),
    ("GET", "/dance/moves/{mid}"): ("/dance/moves/m0a1b2c3d", LC),
    ("POST", "/dance/moves/{mid}"): ("/dance/moves/m0a1b2c3d", LC),
    ("DELETE", "/dance/moves/{mid}"): ("/dance/moves/m0a1b2c3d", LC),
    # #267: the base movements the dancer taught – what the body showed, as a regression: this Mac and Dream Control only
    ("GET", "/dance/faders"): ("/dance/faders", LC),
    ("POST", "/dance/faders"): ("/dance/faders", LC),
    ("POST", "/dance/faders/{fid}"): ("/dance/faders/f0a1b2c3d", LC),
    ("DELETE", "/dance/faders/{fid}"): ("/dance/faders/f0a1b2c3d", LC),
    # #276: recording the output – only the stage on this Mac hands its video in and shows the file in the Finder
    ("POST", "/rec/start"): ("/rec/start", {"local"}),
    ("POST", "/rec/chunk/{rid}"): ("/rec/chunk/0123456789abcdef", {"local"}),
    ("POST", "/rec/end/{rid}"): ("/rec/end/0123456789abcdef", {"local"}),
    ("POST", "/rec/reveal"): ("/rec/reveal", {"local"}),
    # #253: Flowtrack's performers – what was learned of a person: this Mac and Dream Control only
    ("GET", "/flow/profiles"): ("/flow/profiles", LC),
    ("POST", "/flow/profiles"): ("/flow/profiles", LC),
    ("POST", "/flow/profiles/{pid}"): ("/flow/profiles/p0a1b2c3d", LC),
    ("POST", "/flow/profiles/{pid}/export"): ("/flow/profiles/p0a1b2c3d/export", LC),
    ("DELETE", "/flow/profiles/{pid}"): ("/flow/profiles/p0a1b2c3d", LC),
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
WS = {"/ws": LC, "/make": LC, "/ctl": LCGE, "/out": {"local"}, "/view": LCGEW,
      "/facemarks": {"local"}}                         # #214: only the stage on this Mac says where a painted face has its eyes
# what each role may do (rights.ROLES), written down by hand too: the pages are told it with their role
CAN = {
    "local": ["beat", "control", "ctl", "eyes", "faces", "feed", "names", "render", "set:all", "stage", "state", "view"],
    "control": ["beat", "control", "ctl", "eyes", "faces", "feed", "names", "pair_eyes", "render", "set:all", "state",
                "take_over", "view"],
    "guest": ["ctl", "set:guest", "state", "view"],
    "eyes": ["beat", "ctl", "eyes", "eyes_only", "faces", "feed", "view"],
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
    server.hub.beats.clear()


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
    server.hub.save_state()
    ctl_session(server, "control", [{"set": {"strength": "NaN", "zoom": 1e400, "seed": "1e999", "hue": float("inf")}},
                                    {"set": {"prompt": "after"}}],
                done=lambda: server.hub.state["prompt"] == "after")
    assert (server.hub.state["strength"], server.hub.state["zoom"]) == (0.5, saved_state["zoom"])
    assert json.load(open(server.hub.STATE_FILE))["strength"] == 0.5


# ---------- #216: "Reset" – only Dream Control and this Mac ----------
@pytest.fixture
def quick_glide(server, monkeypatch):
    """The glide in a fraction of its four seconds; no reset of an earlier test can still be taken back."""
    monkeypatch.setattr(server.hub, "GLIDE_SECS", 0.15)
    monkeypatch.setattr(server.hub, "GLIDE_STEP", 0.01)
    server.hub.undo.update(values=None, until=0.0)
    yield
    server.hub.undo.update(values=None, until=0.0)


CHANGED = {"zoom": -0.03, "rot": 2.5, "strength": 0.9, "smooth": 0.9, "fx": "tunnel+waves", "fx_amt": 0.2, "auto": True,
           "style": "watercolour", "style_amt": 1.6, "style_ref": "0123456789ab", "style_ref_amt": 0.4,
           "music_pattern": "Flow", "master": 0.4}
KEPT = {"prompt": "a quiet lake at dawn", "model": "sdxl-turbo", "quality": 3, "size": 768, "aspect": "wide", "mode": "img",
        "cam_device": "Camera A", "flow_device": "Camera B", "playlist": "", "syphon": True, "seed": 77,
        "running": False, "music": "mic", "interval": 30,
        "music_patterns": False, "fx_beat": False, "beat_snap": "beat"}


@pytest.mark.parametrize("role", ["guest", "eyes"])
def test_ctl_reset_is_refused(server, monkeypatch, saved_state, quick_glide, role):
    server.hub.state.update(CHANGED)
    noted = []
    monkeypatch.setattr(server.eyes, "eyes_note", noted.append)
    ctl_session(server, role, [{"reset": True}, {"reset": "undo"}, {"set": {"prompt": "the mark"}}, {"done": 1}],
                done=lambda: server.hub.state["prompt"] == "the mark" or {"done": 1} in noted)
    time.sleep(0.3)                                    # longer than a glide would take
    assert {k: server.hub.state[k] for k in CHANGED} == CHANGED
    assert server.hub.undo["values"] is None and not server.hub.gliding["keys"]


@pytest.mark.parametrize("role", ["control", "local"])
def test_ctl_reset_glides_home_and_undo_brings_everything_back(server, saved_state, quick_glide, role):
    s, defaults = server.hub.state, server.settings.DEFAULT_STATE
    s.update({**server.settings.RESET, **KEPT, **CHANGED})
    with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
        ws.send_text(json.dumps({"reset": True}))
        seen = []
        while not (seen and "reset" in seen[-1]):
            seen.append(ws.receive_json())
        assert seen[-1]["reset"] == {"undo": server.hub.UNDO_SECS}
        wait_until(lambda: s["zoom"] == defaults["zoom"] and not server.hub.gliding["task"])
        assert {k: s[k] for k in server.settings.RESET} == server.settings.RESET     # home, exactly
        assert (s["fx"], s["auto"], s["fx_amt"]) == ("", False, defaults["fx_amt"])
        assert (s["style"], s["style_amt"], s["style_ref"], s["style_ref_amt"], s["music_pattern"]) == ("", 1.0, "", 0.8, "auto")
        assert s["master"] == 1.0                                                     # #240: full brightness again
        assert {k: s[k] for k in KEPT} == KEPT                                        # and nothing else moved
        ws.send_text(json.dumps({"reset": "undo"}))
        wait_until(lambda: s["zoom"] == CHANGED["zoom"] and not server.hub.gliding["task"])
        assert {k: s[k] for k in CHANGED} == CHANGED                                  # exactly what it was
        assert {k: s[k] for k in KEPT} == KEPT
        assert server.hub.undo["values"] is None                                      # once


# #208: what a broken or hostile page may send instead of a plain value – not hashable, the wrong type, too big
ODD = [[], {}, [[]], {"a": [1]}, None, True, 0, -1, 1.5, 10 ** 400, float("nan"), float("inf"), "", "no-such", "x" * 3000]
ODD_FIELDS = ["set", "cmd", "arg", "auto", "feed", "feed_end", "motion_in", "glow", "eyes_trance", "eyes_cfg", "eyes_mood",
              "seen", "arrived", "fire", "take_control", "renew_guest", "midi_learn", "midi_forget", "sensor_learn",
              "sensor_forget", "sensor_invert", "sensor_impulse", "sensor_sens", "cams", "rule", "live", "dance_map", "dance_lab", "move", "mode", "dance_slots",
              "measure_report"]
ODD_INSIDE = {"feed": ("cam", "motion", "facing"), "motion_in": ("acc", "gyro"), "eyes_cfg": ("trance_every",),
              "live": ("fps", "flow_rate"), "measure_report": ("kind", "fps", "ms_avg", "render"),
              "dance_lab": ("open", "rec", "play"), "move": ("e", "c"), "dance_slots": ("op", "name", "as", "slots")}
ODD_FRAMES = ["", "{not json", "[1]", '"text"', "null", "[" * 100000]


def odd_messages(server) -> list:
    """Every field /ctl reads, and every setting, with every odd value – alone, in a list and inside its dictionary."""
    msgs = [{f: v} for f in ODD_FIELDS for v in ODD]
    msgs += [{f: [v]} for f in ("rule", "cams") for v in ODD]
    msgs += [{f: {k: v}} for f, keys in ODD_INSIDE.items() for k in keys for v in ODD]
    msgs += [{f: {k: [v]}} for f, keys in ODD_INSIDE.items() for k in keys for v in ODD]
    msgs += [{"set": {k: v}} for k in server.settings.SETTINGS for v in ODD if not isinstance(v, (str, bool))]
    return msgs


@pytest.mark.parametrize("role", sorted(WS["/ctl"]))
def test_ctl_ignores_invalid_values_and_stays_open(server, monkeypatch, saved_state, role):
    """#208: a value /ctl cannot use is not taken, whoever sends it – no error in the loop, and the connection stays:
    the message after all the odd ones still arrives."""
    for part, name in ((server.eyes, "eyes_cfg"), (server.inputs, "midi_map"), (server.inputs.sens, "mapping"),
                       (server.hub, "live"), (server.measure, "measure")):
        monkeypatch.setattr(part, name, dict(getattr(part, name)))
    monkeypatch.setattr(server.inputs.sens, "sensitivity", server.inputs.sens.sensitivity)
    monkeypatch.setattr(server.dance, "tables", server.dance.default_tables())
    for name, value in (("slot_sets", {}), ("slot_use", "standard"), ("slot_drafts", {})):
        monkeypatch.setattr(server.dance, name, value)
    monkeypatch.setitem(server.measure.measure, "run", True)       # reports are only read during a measurement run
    monkeypatch.setitem(server.measure.measure, "reports", {})
    monkeypatch.setattr(server.ctl, "renew_guest", lambda: asyncio.sleep(0))
    monkeypatch.setattr(server.hub, "save_soon", lambda: None)
    ticks = itertools.count()                                      # a second per message: a guest's allowance never runs out
    monkeypatch.setattr(server.ctl, "time", types.SimpleNamespace(monotonic=lambda: next(ticks), time=time.time))
    noted = []
    note = server.eyes.eyes_note
    monkeypatch.setattr(server.eyes, "eyes_note", lambda msg: (note(msg), noted.append(msg))[0])
    server.hub.state.update(move_mode="flowtrack", prompt="before", mode="dream")
    url = ws_url(server, "/ctl", role) + ("?role=stage" if role == "local" else "")   # this Mac: as the stage
    with client(server, role).websocket_connect(url) as ws:
        assert ws.receive_json()["role"] == role
        for frame in ODD_FRAMES:
            ws.send_text(frame)
        ws.send_bytes(b"")
        ws.send_bytes(b"not a picture")
        for m in odd_messages(server):
            ws.send_text(json.dumps(m))
        ws.send_text(json.dumps({"set": {"prompt": "still here"}, "seen": "last"}))
        if role == "eyes":
            wait_until(lambda: any(m.get("seen") == "last" for m in noted))
        else:
            wait_until(lambda: server.hub.state["prompt"] == "still here")
    assert server.hub.state["mode"] in server.settings.CHOICES["mode"]
    if role == "guest":
        assert server.hub.state["mode"] == "dream" and server.hub.state["move_mode"] == "flowtrack"


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


@pytest.mark.parametrize("gone", [WebSocketDisconnect(1001), OSError("gallery folder unreadable")])
def test_ctl_device_that_leaves_while_greeted_leaves_no_control_behind(server, monkeypatch, gone):
    """#193: a Dream Control that is gone before its greeting is out (or whose greeting fails) is no longer registered –
    the next Dream Control is Dream Control, not a guest."""
    gallery, greeted = server.ctl.media.gallery_list, []

    def leaving():                                                  # a step of the greeting, after the registration
        greeted.append(1)
        if len(greeted) == 1:
            raise gone
        return gallery()
    monkeypatch.setattr(server.ctl.media, "gallery_list", leaving)
    c, url = client(server, "control"), ws_url(server, "/ctl", "control")
    with contextlib.suppress(Exception), c.websocket_connect(url):    # its greeting never reaches it: nothing to read
        pass
    wait_until(lambda: not server.hub.roles)
    assert not server.hub.clients and not server.hub.key_roles
    with c.websocket_connect(url) as ws:
        assert ws.receive_json()["role"] == "control"


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


# ---------- dream windows (#201, #214): any number, they only look (what they show: tests/test_windows.py) ----------
def test_dream_windows_cannot_steer(server):
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


# ---------- #219: no portrait of the person. The camera's picture of Dreamy Eyes goes to the stage and nowhere else;
# "you in the dream" is drawn on the phone (static/dreamyou.js, tests/js/you.test.mjs). These fail if a picture of the
# person is kept, painted from or asked for again. ----------
CAMERA_PICTURE = b"\xff\xd8" + b"an invented camera picture " * 40 + b"\xff\xd9"


def holds(value, needle: bytes, seen: set | None = None, depth: int = 0) -> bool:
    """Whether these bytes are kept anywhere inside a module's value (dictionaries, lists, tuples, sets, objects)."""
    seen = set() if seen is None else seen
    if id(value) in seen or depth > 8:
        return False
    seen.add(id(value))
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value) == needle
    if isinstance(value, dict):
        return any(holds(v, needle, seen, depth + 1) for v in (*value.keys(), *value.values()))
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(holds(v, needle, seen, depth + 1) for v in value)
    if isinstance(value, types.SimpleNamespace):
        return holds(vars(value), needle, seen, depth + 1)
    return False


def app_parts(server) -> dict:
    """Every module of Dream that is loaded (the app's own files, not the libraries, not the tests)."""
    import os
    import sys
    root = os.path.dirname(os.path.abspath(server.__file__))
    return {name: mod for name, mod in list(sys.modules.items())
            if os.path.dirname(os.path.abspath(getattr(mod, "__file__", None) or "/")) == root}


@pytest.fixture
def lending_eyes(server, monkeypatch, saved_state):
    """Dreamy Eyes that lend their camera, and a stage that takes the pictures – without sockets: what is posted to whom."""
    eyes_sock, stage = object(), object()
    posted = {"frames": [], "texts": []}
    monkeypatch.setattr(server.hub.outbox, "post_frame", lambda sock, data: posted["frames"].append((sock, data)) or True)
    monkeypatch.setattr(server.hub.outbox, "post", lambda sock, text: posted["texts"].append((sock, json.loads(text))) or True)
    monkeypatch.setitem(server.hub.roles, eyes_sock, "eyes")
    monkeypatch.setitem(server.hub.clients, eyes_sock, "remote")
    monkeypatch.setitem(server.hub.clients, stage, "stage")
    monkeypatch.setitem(server.ctl.feeds, "cam", eyes_sock)
    monkeypatch.setattr(server.eyes, "eyes_seen", dict(server.eyes.eyes_seen))
    return types.SimpleNamespace(sock=eyes_sock, stage=stage, posted=posted)


def test_eyes_camera_picture_goes_to_the_stage_and_is_kept_nowhere(server, lending_eyes):
    """The lent camera's picture is passed on to the stage as it is. No part of Dream keeps a copy – not for a moment
    longer, not "only in memory for a portrait" as before #219."""
    before = set(server.eyes.eyes_seen)
    server.eyes.eyes_note({"seen": True, "arrived": True})          # what the page said for a portrait before #219
    asyncio.run(server.ctl.feed_frame(lending_eyes.sock, CAMERA_PICTURE))
    assert lending_eyes.posted["frames"] == [(lending_eyes.stage, CAMERA_PICTURE)]
    assert set(server.eyes.eyes_seen) == before == {"fire"}, "the eyes note nothing about the person in front of them"
    assert all(isinstance(v, (int, float)) for v in server.eyes.eyes_seen.values())
    parts = app_parts(server)
    assert {"eyes", "ctl", "hub", "render", "outbox"} <= set(parts)
    keeps = [name for name, mod in parts.items() if holds(vars(mod), CAMERA_PICTURE)]
    assert keeps == [], f"a camera picture of Dreamy Eyes is kept in: {keeps}"


def test_eyes_paint_faces_from_words_only_never_from_a_picture(server, monkeypatch, lending_eyes):
    """However long someone stands in front of the eyes and whatever their page says: the Mac paints the fantasy faces
    (from their prompts) and nothing else – no "you", no picture-to-picture step, no picture handed to the model."""
    from_picture, painted = [], []
    monkeypatch.setattr(server.render, "_render", lambda *a, **k: from_picture.append((a, k)))
    monkeypatch.setattr(server.render, "_render_now", lambda *a, **k: from_picture.append((a, k)))

    def make_picture(key, prompt, w, h, seed, **more):
        painted.append((key, prompt, w, h, seed, more))
        return "a painted face"
    monkeypatch.setattr(server.render, "make_picture", make_picture)
    monkeypatch.setattr(server.render, "_jpeg", lambda pic: b"\xff\xd8 painted")
    monkeypatch.setattr(server.eyes, "aimasks", {})
    monkeypatch.setattr(server.eyes, "aimask_state", {"last": 0.0, "i": 0})
    monkeypatch.setattr(server.eyes, "AIMASK_EVERY", 0.0)
    monkeypatch.setitem(server.render.model_state, "loading", False)
    server.hub.state.update(backend="local", running=True, prompt="a quiet lake at dawn")
    rounds = len(server.eyes.AIMASK_PROMPTS) + 3
    for _ in range(rounds):
        server.eyes.eyes_note({"seen": True, "arrived": True, "fire": False})
        asyncio.run(server.ctl.feed_frame(lending_eyes.sock, CAMERA_PICTURE))
        asyncio.run(server.eyes.aimask_step())
    assert len(painted) == rounds and from_picture == []
    assert set(server.eyes.aimasks) == set(server.eyes.AIMASK_PROMPTS) and "you" not in server.eyes.aimask_msg()["aimasks"]
    for call in painted:
        assert not holds(list(call), CAMERA_PICTURE)
        assert all(isinstance(v, (str, int, float, bool)) for v in (*call[:5], *call[5].values())), "words and numbers only"
    assert not any(holds(vars(mod), CAMERA_PICTURE) for mod in app_parts(server).values())


def test_eyes_have_no_way_to_a_portrait_in_the_code(server):
    """Fail closed, in the files themselves: eyes.py has nothing that takes a picture (no image library, no
    picture-to-picture call, no place for a frame); the page sends its camera only as the feed it lends to the stage
    (one sender, common.js) and no word about who stands in front of it; "you in the dream" is drawn by dreamyou.js."""
    import os
    root = os.path.dirname(os.path.abspath(server.__file__))
    part = open(os.path.join(root, "eyes.py"), encoding="utf-8").read()
    for word in ("PIL", "Image", "_render", "frame", "YOU_", '"you"', "img2img", "io.BytesIO"):
        assert word not in part, f"eyes.py: {word}"
    assert not any(hasattr(server.eyes, name) for name in ("YOU_PROMPT", "YOU_EVERY", "YOU_KEEP"))
    assert "eyes.eyes_seen" not in open(os.path.join(root, "ctl.py"), encoding="utf-8").read()
    page = open(os.path.join(root, "static", "eyes.html"), encoding="utf-8").read()
    assert page.count("DreamCommon.cameraSender(") == 1
    for word in ("toBlob", "toDataURL", "captureStream", "MediaRecorder", "seen: true", "arrived: true", "aiFaces.you", "FormData", "fetch("):
        assert word not in page, f"eyes.html: {word}"
    assert page.count(".send(") == 1 and "ctl.send(JSON.stringify(m))" in page     # words over /ctl; pictures only by the lent feed
    assert '<script src="/static/dreamyou.js"></script>' in page and "DreamYou.compose(" in page


# ---------- #218: Dreamy Eyes hear the music's beat – one number, and nothing else the stage tells its windows ----------
STAGE_SAYS = [                                         # what the stage tells its output windows over /out
    json.dumps({"fx": {"k": 0.8, "amts": {"kaleido": 0.7}, "pulse": 0.5, "bass": 0.4, "spin": 0.3, "t": 12.5, "seed": 7,
                       "dir": 1, "cx": 0.5, "cy": 0.5, "loc": 0, "ang": 0}}),
    json.dumps({"pulse": 0.25}),
    json.dumps({"fade": 1.5, "prompt": "a quiet lake at dawn"}),
    json.dumps({"smooth": 0.2}),
    json.dumps({"calib": {"x": 0.4, "y": 0.6}}),
    json.dumps({"morph": [1, 2], "n": 3, "pulse": "not a number"}),
    '{"pulse": 0.9',                                   # cut off: not JSON
]


def test_the_beat_is_one_number(server):
    beat_of = server.output.beat_of
    assert beat_of(STAGE_SAYS[0]) == pytest.approx(0.5 * 0.8 + 0.4 * 0.3)     # as a dream window makes it of the effects
    assert beat_of(STAGE_SAYS[1]) == 0.25
    assert [beat_of(t) for t in STAGE_SAYS[2:]] == [None] * 5
    assert beat_of(json.dumps({"pulse": 7})) == 1.0 and beat_of(json.dumps({"pulse": -3})) == 0.0
    assert beat_of(json.dumps(["pulse"])) is None and beat_of('"pulse"') is None
    assert server.rights.roles_with("beat") == {"local", "control", "eyes"}


def test_eyes_hear_only_the_beat(server, monkeypatch):
    """The eyes' key gets a pulse number beside its preview – never the stage's own messages (effects, fades with a
    prompt, flow fields). A guest's preview gets nothing of it, even asking as the eyes; output and dream windows get
    everything, as before."""
    told = []                                          # (role of the socket, text) for every text the server queues
    post = server.output.outbox.post
    monkeypatch.setattr(server.output.outbox, "post", lambda sock, data: (
        told.append((server.hub.key_roles.get(sock), data)) if isinstance(data, str) else None, post(sock, data))[1])
    monkeypatch.setitem(server.output.beat, "at", 0.0)
    monkeypatch.setitem(server.output.beat, "peak", 0.0)
    monkeypatch.setattr(server.output, "BEAT_EVERY", 0.0)                  # every beat, for the test
    k = server.rights.keys
    at = "ws://192.168.1.20:7860/view"
    with client(server, "eyes").websocket_connect(f"{at}?preview=1&as=eyes&k={k['eyes']}") as eyes, \
            client(server, "guest").websocket_connect(f"{at}?preview=1&as=eyes&k={k['guest']}"), \
            client(server, "guest").websocket_connect(f"{at}?preview=1&k={k['guest']}"), \
            client(server, "guest").websocket_connect(f"{at}?k={k['guest']}"), \
            client(server, "window").websocket_connect(f"{at}?as=window&k={k['window']}"), \
            client(server, "local").websocket_connect("ws://127.0.0.1:7860/out") as out:
        wait_until(lambda: len(server.hub.previews) == 3 and len(server.hub.viewers) == 2)
        assert [server.hub.key_roles[s] for s in server.hub.beats] == ["eyes"]     # the guest asking as the eyes: no
        assert server.hub.status_msg()["live"]["beats"] == 1                       # the stage learns somebody listens
        told.clear()
        for text in STAGE_SAYS:
            out.send_text(text)
        wait_until(lambda: sum(1 for r, _ in told if r == "window") >= len(STAGE_SAYS))
        heard = []                                     # the eyes' socket itself: its greeting, then all it was told
        while len(heard) < sum(1 for r, t in told if r == "eyes" and '"master"' not in t):
            text = eyes.receive_text()
            if '"master"' not in text:
                heard.append(text)
        assert heard == ['{"pulse": 0.52}', '{"pulse": 0.25}']
    by = {r: [t for who, t in told if who == r and '"master"' not in t and '"motif"' not in t and '"window"' not in t
              and '"aimasks"' not in t] for r in ("eyes", "guest", "window")}      # late greetings aside
    assert by["eyes"] == ['{"pulse": 0.52}', '{"pulse": 0.25}']                   # two numbers, nothing else
    assert by["window"] == STAGE_SAYS                                              # the dream window: everything, as before
    assert by["guest"] == STAGE_SAYS                                               # the guest's output window too – once:
    assert not any("lake" in t or "amts" in t or "morph" in t for t in by["eyes"])  # its two previews got nothing


def test_eyes_get_the_points_of_their_painted_faces_and_nothing_more(server, monkeypatch):
    """#230: Dreamy Eyes move the painted face in their pupils, so Dream hands them where it has its eyes, brows and
    mouth – found by the stage on this Mac, asked for although no dream window is there. Over /ctl the eyes still hear
    only their own few things, a guest hears no points, and nobody but the stage says where a face is."""
    w, face = server.windows, "0123456789ab"
    pts = [(i * 37) % 1001 for i in range(2 * w.FACE_POINTS)]
    for d in (server.hub.windows, w.marks, w.asked, server.eyes.aimasks):
        d.clear()
    server.eyes.aimasks["goddess"] = (face, b"jpeg", time.time())
    told, noted = [], []
    post = w.outbox.post
    monkeypatch.setattr(w.outbox, "post", lambda sock, data: (
        told.append((server.hub.key_roles.get(sock), json.loads(data))) if isinstance(data, str) else None, post(sock, data))[1])
    monkeypatch.setattr(server.eyes, "eyes_note", noted.append)
    heard = lambda role, key: [m[key] for r, m in told if r == role and key in m]
    try:
        with client(server, "local").websocket_connect("ws://127.0.0.1:7860/facemarks") as stage, \
                client(server, "guest").websocket_connect(ws_url(server, "/ctl", "guest")), \
                client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes") + "&as=eyes") as eyes:
            wait_until(lambda: heard("eyes", "eyes_cfg") and heard("guest", "state"))
            assert heard("eyes", "aimasks") == [{"goddess": f"/eyes/mask/{face}.jpg"}] and not heard("eyes", "marks")
            w.marks_tick(time.time())                  # no dream window anywhere: the eyes alone are reason enough to ask
            assert json.loads(stage.receive_text()) == {"face": face, "url": f"/eyes/mask/{face}.jpg"}
            stage.send_text(json.dumps({"face": face, "points": pts}))
            wait_until(lambda: heard("eyes", "marks"))
            assert heard("eyes", "marks") == [{face: pts}]
            for claim in ({"face": face, "points": [0] * len(pts)}, {"marks": {face: [0] * len(pts)}}, {"done": 1}):
                eyes.send_text(json.dumps(claim))      # the eyes cannot say where a face is
            wait_until(lambda: {"done": 1} in noted)
            assert w.marks == {face: pts}
            with client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes") + "&as=eyes"):   # eyes that come later
                wait_until(lambda: len(heard("eyes", "eyes_cfg")) == 2)
        assert heard("eyes", "marks") == [{face: pts}, {face: pts}]
        late = [m for r, m in told if r == "eyes"][-4:]    # the faces first, then their points
        assert [k for m in late for k in ("aimasks", "marks") if k in m] == ["aimasks", "marks"]
        assert {k for r, m in told if r == "eyes" for k in m} == {"role", "can", "can_take", "feeds_mine", "aimasks", "marks", "eyes_cfg", "world", "world_to", "world_mix"}
        assert not heard("guest", "marks") and not heard("guest", "aimasks")
        server.eyes.aimasks.clear()                    # no painted face: no points for anyone
        w.marks_tick(time.time())
        with client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes") + "&as=eyes"):
            wait_until(lambda: len(heard("eyes", "eyes_cfg")) == 3)
        assert len(heard("eyes", "marks")) == 2
    finally:
        for d in (server.hub.windows, w.marks, w.asked, server.eyes.aimasks):
            d.clear()


def test_no_painted_faces_when_switched_off(server, monkeypatch):
    """DREAM_AIMASK=0 (#218): the face painter ends at once – Dreamy Eyes never make this Mac load a model."""
    import asyncio
    monkeypatch.setattr(server.eyes, "AIMASK", False)
    monkeypatch.setattr(server.render, "make_picture", lambda *a, **kw: pytest.fail("a face was painted"))
    monkeypatch.setattr(asyncio, "sleep", lambda *a: pytest.fail("the painter waits for its next face"))
    asyncio.run(server.real_loops["aimask_loop"]())


def test_eyes_are_told_the_style_world_and_cannot_set_it(server, monkeypatch, saved_state):
    """#221, #224: the style world and its crossfade (the world it fades to, how far) are the only settings Dreamy Eyes
    hear of – as one small word, when they come and when it changes. Their key changes nothing of them, nor does a
    guest's; and a guest is told through the shared state as always."""
    monkeypatch.setattr(server.settings, "WORLDS", ("classic", "other"))   # (a second world, for the test)
    monkeypatch.setitem(server.settings.SETTINGS, "world", server.settings.text("classic", choices=("classic", "other")))
    monkeypatch.setitem(server.settings.SETTINGS, "world_to", server.settings.text("classic", choices=("classic", "other")))
    server.hub.state.update(world="classic", world_to="classic", world_mix=0.0, world_auto=0)
    with client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes") + "&as=eyes") as eyes:
        greeting = [eyes.receive_json() for _ in range(3)]
        assert greeting[0]["role"] == "eyes"
        assert [{k: v for k, v in m.items() if k.startswith("world")} for m in greeting if "world" in m] == [
            {"world": "classic", "world_to": "classic", "world_mix": 0.0}]   # (not the drift's pace: Dream steps the mix)
        assert not any("state" in m or "set" in m for m in greeting)       # nothing else of the shared state
        eyes.send_text(json.dumps({"set": {"world": "other", "world_to": "other", "world_mix": 1, "world_auto": 5}}))
        ctl_session(server, "guest", [{"set": {"world": "other", "world_to": "other", "world_mix": 1, "world_auto": 5,
                                               "prompt": "a guest was here"}}],
                    done=lambda: server.hub.state["prompt"] == "a guest was here")
        assert [server.hub.state[k] for k in ("world", "world_to", "world_mix", "world_auto")] == ["classic", "classic", 0.0, 0]   # neither the eyes nor a guest
        ctl_session(server, "control", [{"set": {"world": "other"}}], done=lambda: server.hub.state["world"] == "other")
        told = eyes.receive_json()
        while "world" not in told:                                         # (who is connected, in between)
            assert set(told) <= {"live", "feeds_mine", "aimasks", "eyes_cfg"}, told
            told = eyes.receive_json()
        assert told == {"world": "other", "world_to": "classic", "world_mix": 0.0}
        ctl_session(server, "control", [{"set": {"world_to": "other", "world_mix": 0.5}}], done=lambda: server.hub.state["world_mix"] == 0.5)
        assert eyes.receive_json() == {"world": "other", "world_to": "other", "world_mix": 0.5}   # one word for both


# ---------- #237: a phone glows as a light marker while it lends its motion ----------
def next_that(ws, test) -> dict:
    """The next message the test holds for."""
    for _ in range(80):
        msg = ws.receive_json()
        if test(msg):
            return msg
    raise AssertionError("no such message")


def say(ws, **msg) -> None:
    ws.send_text(json.dumps(msg))


def until_prompt(ws, text: str) -> list:
    """Everything this device was told up to the change of the prompt (sent after all the rest)."""
    told = []
    while not told or told[-1].get("set", {}).get("prompt") != text:
        told.append(ws.receive_json())
    return told


@pytest.fixture
def marker_dance(server, monkeypatch, saved_state):
    """Dream Dance looks for two LED markers – cyan on the left, magenta on the right; the sensors start empty."""
    import sensors
    monkeypatch.setattr(server.inputs, "sens", sensors.Sensors())
    server.hub.state.update(move_mode="dance", move_off="", dance_kind="marker", marker_l="cyan", marker_r="magenta", prompt="")
    yield server.hub.state
    assert not server.movement.glows.by and not any(server.ctl.feeds.values())   # every glow went with its phone


def test_a_phone_glows_only_while_it_lends_its_motion_and_only_it_and_the_mac_hear_of_it(server, marker_dance):
    url = lambda role: ws_url(server, "/ctl", role)                             # noqa: E731
    with client(server, "local").websocket_connect(url("local") + "?role=stage") as stage, \
            client(server, "guest").websocket_connect(url("guest")) as guest, \
            client(server, "control").websocket_connect(url("control")) as phone:
        say(phone, glow="cyan")                                                 # it lends nothing yet: not heard
        say(phone, feed={"motion": True})
        assert next_that(phone, lambda m: m.get("feeds_mine"))["feeds_mine"] == ["motion"]
        assert not server.movement.glows.by
        for odd in ("red", "orange", "yellow", "white", 7, ["cyan"], None):     # fire colours and nonsense: no glow
            say(phone, glow=odd)
        say(phone, glow="magenta")
        assert next_that(phone, lambda m: "glow" in m) == {"glow": {"colour": "magenta", "hand": "r", "tracked": True}}
        assert next_that(stage, lambda m: (m.get("feeds") or {}).get("motion", {}) and m["feeds"]["motion"].get("glow"))["feeds"]["motion"] \
            == {"by": "Dream Control", "glow": "magenta"}
        say(phone, set={"dance_kind": "hand", "marker_r": "blue"})              # no markers looked for, the hand's colour changed
        assert next_that(phone, lambda m: "glow" in m) == {"glow": {"colour": "magenta", "hand": None, "tracked": False}}
        say(phone, glow="")
        assert next_that(phone, lambda m: "glow" in m) == {"glow": None}
        say(phone, glow="green")
        next_that(phone, lambda m: m.get("glow"))
        say(phone, feed={"motion": False})                                      # the motion ends: the glow ends with it
        assert next_that(phone, lambda m: m.get("feeds_mine") == [])
        assert not server.movement.glows.by
        say(phone, set={"prompt": "the end"})
        told = until_prompt(guest, "the end")                                  # a guest saw the feeds, never a glow
        assert any((m.get("feeds") or {}).get("motion") for m in told)
        assert not any("glow" in m for m in told)
        assert not any("glow" in (f or {}) for m in told for f in (m.get("feeds") or {}).values())
    wait_until(lambda: not any(server.ctl.feeds.values()))


def test_dreamy_eyes_never_hear_of_a_glow(server, monkeypatch, marker_dance):
    told = []
    import outbox
    post = outbox.post
    monkeypatch.setattr(outbox, "post", lambda sock, text: (told.append((server.hub.roles.get(sock), json.loads(text))), post(sock, text))[1])
    url = lambda role: ws_url(server, "/ctl", role)                             # noqa: E731
    with client(server, "eyes").websocket_connect(url("eyes")), client(server, "control").websocket_connect(url("control")) as phone:
        say(phone, feed={"motion": True})
        say(phone, glow="cyan")
        assert next_that(phone, lambda m: m.get("glow"))["glow"]["hand"] == "l"
        say(phone, feed={"motion": False})
        next_that(phone, lambda m: m.get("feeds_mine") == [])
    eyes_heard = [m for role, m in told if role == "eyes"]
    assert eyes_heard and not any("glow" in json.dumps(m) for m in eyes_heard)
    assert any("glow" in m for role, m in told if role == "control")


@pytest.mark.parametrize("role", ["guest", "eyes"])
def test_guests_and_eyes_lend_no_motion_and_cannot_glow(server, monkeypatch, marker_dance, role):
    noted = []
    note = server.eyes.eyes_note
    monkeypatch.setattr(server.eyes, "eyes_note", lambda msg: (note(msg), noted.append(msg))[0])
    msgs = [{"feed": {"motion": True}}, {"glow": "cyan"}, {"motion_in": {"gyro": [90, 0, 0]}}, {"set": {"prompt": "done"}, "seen": "last"}]
    ctl_session(server, role, msgs, done=lambda: marker_dance["prompt"] == "done" or any(m.get("seen") == "last" for m in noted))
    assert not server.ctl.feeds["motion"] and not server.ctl.feeds["motion2"]
    assert not server.movement.glows.by and not server.inputs.sens.arms and marker_dance["marker_l"] == "cyan"


def test_a_second_phone_with_dream_controls_key_is_the_second_hand_and_nothing_more(server, monkeypatch, marker_dance):
    import outbox
    told, post = [], outbox.post
    monkeypatch.setattr(outbox, "post", lambda sock, text: (told.append(json.loads(text)), post(sock, text))[1])
    c, url = client(server, "control"), ws_url(server, "/ctl", "control")
    with c.websocket_connect(url) as one, c.websocket_connect(url) as two:
        assert one.receive_json()["role"] == "control" and two.receive_json()["role"] == "guest"
        say(one, feed={"motion": True})
        say(one, glow="cyan")
        assert next_that(one, lambda m: m.get("glow"))["glow"] == {"colour": "cyan", "hand": "l", "tracked": True}
        say(two, feed={"motion": True, "cam": True})                             # its motion – never its camera
        assert next_that(two, lambda m: m.get("feeds_mine"))["feeds_mine"] == ["motion"]
        assert server.ctl.feeds["cam"] is None and server.ctl.feeds["motion2"] is not None
        assert server.ctl.feeds["motion"] is not server.ctl.feeds["motion2"]    # it took nothing from the first
        say(two, glow="cyan")                                                   # taken: the free hand's colour instead
        assert next_that(two, lambda m: m.get("glow"))["glow"] == {"colour": "magenta", "hand": "r", "tracked": True}
        say(two, glow="green")                                                  # its own choice: its hand's marker colour now
        assert next_that(two, lambda m: (m.get("glow") or {}).get("colour") == "green")["glow"]["hand"] == "r"
        assert (marker_dance["marker_l"], marker_dance["marker_r"]) == ("cyan", "green")
        assert server.movement.glows.by == {"Dream Control": "cyan", "Dream Control 2": "green"}
        # each phone's motion stays its own: its channels, and its arm by the hand of its colour (degrees → rad/s)
        say(one, motion_in={"gyro": [90, 0, 0]})
        for _ in range(60):                                                     # two seconds of motion at once: none of it
            say(two, motion_in={"gyro": [0, 0, 180]})                           # counts against what it may say as a guest
        say(two, set={"marker_l": "blue", "dance_kind": "hand", "quality": 4}, sensor_learn="zoom", feed_end="motion")   # still a guest
        say(two, set={"prompt": "second"})
        wait_until(lambda: marker_dance["prompt"] == "second")
        arms = server.inputs.glow_arms()
        assert arms["l"]["g"] == pytest.approx([1.571, 0, 0]) and arms["r"]["g"] == pytest.approx([0, 0, 3.142])
        assert {"/device/gyroscope:0", "/device2/gyroscope:2"} <= set(server.inputs.sens.ch)
        assert (marker_dance["marker_l"], marker_dance["dance_kind"]) == ("cyan", "marker") and not server.inputs.sens.learn
        assert server.ctl.feeds["motion"] is not None
        say(two, take_control=True)                                             # the roles change: what both lent ends
        assert next_that(one, lambda m: m.get("feeds_mine") == [])
        wait_until(lambda: not any(server.ctl.feeds.values()) and not server.movement.glows.by)
    # no phone was told the other's colour: the feeds they hear of carry none, a glow message is the phone's own
    assert not any("glow" in (f or {}) for m in told for f in (m.get("feeds") or {}).values())
    assert {m["glow"]["colour"] for m in told if m.get("glow")} == {"cyan", "magenta", "green"}


def test_a_phone_that_takes_the_motion_over_does_not_inherit_the_glow(server, marker_dance):
    url = ws_url(server, "/ctl", "control")
    with client(server, "control").websocket_connect(url) as phone, \
            client(server, "local").websocket_connect(ws_url(server, "/ctl", "local")) as mac:
        say(phone, feed={"motion": True})
        say(phone, glow="blue")
        assert next_that(phone, lambda m: m.get("glow"))["glow"]["colour"] == "blue"
        say(mac, feed={"motion": True})
        assert next_that(phone, lambda m: "feed_taken" in m) == {"feed_taken": "motion"}   # its page ends the glow with it
        assert not server.movement.glows.by
