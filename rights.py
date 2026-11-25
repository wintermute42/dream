"""Who may do what (#148, #156, #175, #201; one table since #189).

A request's role comes from where it comes from and the key it brings: "local" (this Mac), "control" (Dream Control),
"guest" (Dream Remote, the output window on a second device), "eyes" (Dreamy Eyes: a phone that only lends its front
camera), "window" (a dream window: it only looks) or None (no access). `ROLES` says what each role may do; every check
in Dream asks `can(role, capability)` or goes through the middleware `guard` – a new role is one entry in the table, a
new right one capability. The pages get their role's capabilities with the role (the /ctl message, `role_msg`) and only
hide what the server refuses anyway.

Nothing here loads PyTorch: the rights can be read and tested without a model."""
import html
import ipaddress
import json
import logging
import os
import re
import secrets
from dataclasses import dataclass

from fastapi import Request, WebSocket
from fastapi.responses import JSONResponse, Response

import config
import i18n
import paths

STATE_DIR = paths.state_dir()                              # #186: DREAM_STATE_DIR, default ~/.local/state/dream
os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)

# ---------- what can be allowed ----------
CAPABILITIES = {
    "stage": "what only this Mac does: be the stage, send its pictures (/out), hand pictures and clips to the gallery, "
             "renew the guests' key, see every link and QR code",
    "control": "everything of Dream Control: the routes that cost money, change the owner's files or use the Mac's camera "
               "(CONTROL_ONLY), learning MIDI and sensors, ending another device's feed, the Dreamy Eyes' trance, the "
               "cloud's status",
    "render": "paint with this Mac's image model (/ws, /make)",
    "ctl": "the control line (/ctl)",
    "view": "watch the pictures the stage shows (/view)",
    "state": "learns the shared state and every change of it",
    "set:all": "change every setting, send every command",
    "set:guest": "change the guests' settings (settings.GUEST_KEYS) and send the guests' commands (GUEST_CMDS), about 20 "
                 "messages a second",
    "feed": "lend its camera to the stage (Dream Control: its motion sensors too)",
    "eyes": "may be a Dreamy Eyes page: the painted faces, how often the trance comes",
    "eyes_only": "is nothing but Dreamy Eyes: learns nothing of the shared state, says nothing but lending its front camera",
    "faces": "the faces painted for Dreamy Eyes (/eyes/mask), and where each has its eyes, brows and mouth (#230)",
    "beat": "as a Dreamy Eyes page, hears the music's beat beside its small preview of the dream (/view): one number "
            "between 0 and 1, now and then – nothing else of what the stage tells its output windows (#218)",
    "pair_eyes": "gets the links and QR codes that pair Dreamy Eyes and dream windows",
    "take_over": "may take Dream Control over from another device (one at a time); while it stands by as the second "
                 "phone it may lend its motion sensors and glow as a light marker, nothing else (#237, ctl.slot_for)",
}

# #175: everything a guest (Dream Remote, the output window on a second device) may ask over HTTP; the rest is for
# Dream Control and this Mac – a new route is closed to guests until it is added here
GUEST_HTTP = re.compile(r"GET /(remote|output|health|remote-info|cloud)|GET /static/[\w./-]+|GET /media/[^/]+"
                        r"|GET /style-ref/[^/]+|GET /mp/[\w./-]+|POST /gallery/[^/]+/use")
# #156: all Dreamy Eyes may reach over http – its page and its files; the rest is closed to it (fail closed)
EYES_PATHS = re.compile(r"/eyes|/eyes/mask/[0-9a-f]{12}\.jpg|/static/[\w./-]+|/mp/[\w./-]+")   # #157: /mp – face detection; #160: masks
WINDOW_PATHS = re.compile(r"/window|/static/[\w./-]+|/eyes/mask/[0-9a-f]{12}\.jpg")   # #201: all a dream window may ask
GUEST_CMDS = {"next", "tap", "tapoff", "make", "fx"}


@dataclass(frozen=True)
class Role:
    can: frozenset                    # its capabilities (CAPABILITIES)
    key: str | None = None            # the file of its key in the state folder; None: this Mac needs no key
    http: re.Pattern | None = None    # the only requests ("METHOD /path") it may make; None: all its capabilities allow
    cookie: str | None = None         # a cookie of its own for its key, so it never replaces another role's key
    pairs: bool = False               # #170: asked for another page of the app, it gets the pairing page


def _get(paths_: re.Pattern) -> re.Pattern:
    return re.compile(f"GET (?:{paths_.pattern})")


ROLES: dict[str, Role] = {
    "local": Role(frozenset({"stage", "control", "render", "ctl", "view", "state", "set:all", "feed", "eyes", "faces",
                             "beat"})),
    "control": Role(frozenset({"control", "render", "ctl", "view", "state", "set:all", "feed", "eyes", "faces", "beat",
                               "pair_eyes", "take_over"}), key="control-token"),
    "guest": Role(frozenset({"ctl", "view", "state", "set:guest"}), key="remote-token", http=GUEST_HTTP),
    "eyes": Role(frozenset({"ctl", "view", "feed", "eyes", "eyes_only", "faces", "beat"}), key="eyes-token",
                 http=_get(EYES_PATHS), cookie="dream_e", pairs=True),
    "window": Role(frozenset({"view", "faces"}), key="window-token", http=_get(WINDOW_PATHS), cookie="dream_w", pairs=True),
}
assert all(r.can <= set(CAPABILITIES) for r in ROLES.values())


def can(role: str | None, capability: str) -> bool:
    """May this role do that? No role (None) may nothing."""
    return role in ROLES and capability in ROLES[role].can


def roles_with(capability: str) -> set:
    return {name for name, r in ROLES.items() if capability in r.can}


# ---------- the keys (#148): 96 bits each, readable only by the owner ----------
def _key(path: str, renew: bool = False) -> str:
    if renew or not os.path.exists(path):
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            f.write(secrets.token_urlsafe(12))
    with open(path) as f:
        return f.read().strip()


def key_file(role: str) -> str:
    return os.path.join(STATE_DIR, ROLES[role].key)


keys = {name: _key(key_file(name)) for name, r in ROLES.items() if r.key}


def renew_key(role: str) -> str:
    keys[role] = _key(key_file(role), renew=True)
    return keys[role]


def is_local(host) -> bool:
    return host in ("127.0.0.1", "::1", "localhost", None)


def role_of(host, query_k, cookie_k) -> str | None:
    """#148: "local" (this Mac), "control" (Dream Control), "guest" (Dream Remote), "eyes" (#156: Dreamy Eyes, a phone
    that only lends its front camera), "window" (#201: a dream window – it only looks) or None (no access)."""
    if is_local(host):
        return "local"
    if not config.LAN:
        return None
    k = str(query_k or cookie_k or "")
    for name in keys:
        if secrets.compare_digest(k, keys[name]):
            return name
    return None


def allowed(host, query_k, cookie_k) -> bool:
    return role_of(host, query_k, cookie_k) is not None


# ---------- HTTP ----------
# #148: what only Dream Control (or this Mac) may do, and what only the stage on this Mac hands in. Checked in the
# middleware before a handler reads anything; a new route that costs money or changes the owner's files goes here.
CONTROL_ONLY = [("POST", r"/cloud/(start|stop)"), ("GET", r"/cloud"), ("POST", r"/measure"), ("GET", r"/measure"), ("POST", r"/playlists"), ("DELETE", r"/playlists/.+"),
                ("POST", r"/upload"), ("POST", r"/voice"), ("POST", r"/gallery/[^/]+/(delete|save)"),
                ("POST", r"/gallery/clear"), ("POST", r"/gallery/undo/[^/]+"), ("POST", r"/style-ref"),
                # #243: the dance lab's sessions (trajectories of the owner's dance, kept on this Mac)
                ("GET", r"/dance/sessions(/[^/]+)?"), ("POST", r"/dance/sessions(/[^/]+/export)?"), ("DELETE", r"/dance/sessions/[^/]+")]
# #251, #252: the pages of Dream Dance and Flowtrack are this Mac's (they steer the stage in the window that opened them)
LOCAL_ONLY = [("POST", r"/gallery"), ("GET", r"/dance"), ("GET", r"/flowtrack")]


def needs(method: str, path: str) -> set | None:
    """The roles that may make this request, or None when every role may."""
    if any(method == m and re.fullmatch(r, path) for m, r in LOCAL_ONLY):
        return roles_with("stage")
    if any(method == m and re.fullmatch(r, path) for m, r in CONTROL_ONLY):
        return roles_with("control")
    return None


def only_control():
    return JSONResponse({"error": i18n.t("Only Dream Control may do this.")}, status_code=403)


def cookie_name(scheme: str) -> str:
    """#145: cookies ignore the port – Control's key over https keeps its own cookie, a guest QR won't replace it."""
    return "dream_c" if scheme in ("https", "wss") else "dream_k"


# #145: public, no key: the CA certificate (a device needs it first), the app manifests and icons (browsers fetch
# them without cookies). Nothing in them is secret.
PUBLIC = re.compile(r"/dream-ca\.crt|/static/(remote|control|eyes)\.webmanifest|/static/icons/[\w-]+\.(png|svg|ico)")


def cookie_of(cookies, scheme: str, eyes: bool = False, window: bool = False):
    """The key a device keeps: its own scheme's cookie, else the one of Dreamy Eyes (#156: a cookie of its own, so
    trying the eyes on the owner's phone never replaces Dream Control's key). #166: the eyes' page asks for the
    eyes' key first – a device that is Dream Control as well stays the eyes there (and gets its painted faces)."""
    name = cookie_used(cookies, scheme, eyes, window)
    return cookies.get(name) if name else None


def cookie_used(cookies, scheme: str, eyes: bool = False, window: bool = False) -> str | None:
    """The name of the cookie whose key a request brings (see cookie_of). #201: a dream window has its own cookie."""
    if eyes and cookies.get("dream_e"):
        return "dream_e"
    if window and cookies.get("dream_w"):
        return "dream_w"
    return next((n for n in (cookie_name(scheme), "dream_e", "dream_w") if cookies.get(n)), None)


APP_PAGES = {"/", "/control", "/remote", "/eyes", "/output", "/window"}


def wants_page(request: Request) -> bool:
    return request.method == "GET" and request.url.path in APP_PAGES and "text/html" in request.headers.get("accept", "")


def pair_page(request: Request) -> Response:
    """#170: no key (or no longer a valid one): a page to pair this device – scan the code inside the page or paste
    the link – instead of a bare text an installed app cannot do anything with."""
    al = request.headers.get("accept-language", "").lower()   # the device's own language: it has no Dream cookie yet
    lang = next((x[:2] for x in re.split(r"[,;\s]+", al) if x[:2] in i18n.LANGS), None) or i18n.current.get() or i18n.fallback["lang"]
    tx = {
        "title": i18n.t("Pair with Dream", lang),
        "checking": i18n.t("Looking for this device's key …", lang),
        "lead": i18n.t("This device has no key for Dream yet – or its key is no longer valid.", lang),
        "scan": i18n.t("📷 Scan the QR code", lang),
        "stop": i18n.t("Stop the camera", lang),
        "paste": i18n.t("Or paste the link of the QR code:", lang),
        "pair": i18n.t("Pair", lang),
        "notLink": i18n.t("That is not a link of Dream with a key.", lang),
        "noCamera": i18n.t("No camera – allow it, or paste the link.", lang),
        "noScan": i18n.t("This browser cannot read QR codes itself: scan the code with the camera app instead. Once it has opened Dream in the browser, the installed app is paired as well.", lang),
        "where": "<b>" + html.escape(i18n.t("Where the code is:", lang)) + "</b><br>" + "<br>".join(html.escape(x) for x in (
            i18n.t("Dream Control: on the Mac in the panel under “Output” → 🎛 Dream Control.", lang),
            i18n.t("Dreamy Eyes: in Dream Control on the card “👀 Dreamy Eyes” (or on the Mac: panel → “Output” → 👀 Dreamy Eyes).", lang),
            i18n.t("Guests: press Q on the stage.", lang))),
    }
    page = (open(os.path.join(config.HERE, "static", "pair.html"), encoding="utf-8").read()
            .replace("__TEXTS__", json.dumps(tx, ensure_ascii=False).replace("</", "<\\/"))
            .replace("__LANG__", lang))
    return Response(page, status_code=403, media_type="text/html", headers={"Cache-Control": "no-store"})


class _QuietKeys(logging.Filter):
    """#175: no key in the log (it may end up in an issue or a shared file), and none of the polling every second."""
    def filter(self, record):
        if isinstance(record.args, tuple):
            if record.name == "uvicorn.access" and len(record.args) >= 3 and re.match(r"/(stats|cloud|health)\b", str(record.args[2])):
                return False
            record.args = tuple(re.sub(r"([?&]k=)[^&\s\"]+", r"\1…", a) if isinstance(a, str) else a for a in record.args)
        if isinstance(record.msg, str):
            record.msg = re.sub(r"([?&]k=)[^&\s\"]+", r"\1…", record.msg)
        return True


for _name in ("uvicorn.access", "uvicorn.error"):
    logging.getLogger(_name).addFilter(_QuietKeys())


async def guard(request: Request, call_next):
    """The middleware in front of every HTTP request: the origin, the role, what the role may ask, the key's cookie."""
    host = request.client.host if request.client else None
    qk = request.query_params.get("k")
    cookie = cookie_name(request.url.scheme)
    if not origin_ok(request.headers):            # #175: before anything else – also the public files
        return Response(i18n.t("Not from Dream's own pages."), status_code=403)
    if request.method == "GET" and PUBLIC.fullmatch(request.url.path):
        return await call_next(request)
    # #166, #201: the eyes' page and a dream window ask for their own cookie first – to sign in and to renew it
    own = (request.url.path.startswith("/eyes"), request.url.path.startswith("/window"))
    request.state.role = role_of(host, qk, cookie_of(request.cookies, request.url.scheme, *own))
    if request.state.role is None:
        if wants_page(request):
            return pair_page(request)
        return Response(i18n.t("No access. Please scan the QR code on the stage – or, for Dream Control, its code in the panel (Output)."), status_code=403)
    role = ROLES[request.state.role]
    if role.http and not role.http.fullmatch(f"{request.method} {request.url.path}"):
        # fail closed: a guest only what Dream Remote and the output need (#175), Dreamy Eyes and a dream window only
        # their page, files and faces (#156, #201). #170: a device that only has the eyes' or a window's key and opens
        # another page (e.g. the Dream Control app whose own cookie stayed behind) gets the pairing page – it retries
        # once (bringing a strict Control cookie along) or lets it pair
        return pair_page(request) if role.pairs and wants_page(request) else only_control()
    if role.cookie and qk:
        cookie = role.cookie
    need = needs(request.method, request.url.path)
    if need and request.state.role not in need:
        return only_control()
    resp = await call_next(request)
    if qk and not is_local(host):
        # #168: "lax", not "strict" – an installed app opened from the home screen (or a link from another app) is a
        # navigation from outside; a strict cookie stays behind there and the app finds no key. Lax still keeps it
        # away from other sites' forms and requests.
        resp.set_cookie(cookie, qk, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 365,
                        secure=request.url.scheme == "https")
    elif not qk and not is_local(host) and wants_page(request):
        # #170: a key that works is renewed on every page – as "lax" (a cookie from before #168 was "strict") and for
        # another year
        used = cookie_used(request.cookies, request.url.scheme, *own)   # the one it signed in with, no other
        if used:
            resp.set_cookie(used, request.cookies[used], httponly=True, samesite="lax", max_age=60 * 60 * 24 * 365,
                            secure=request.url.scheme == "https")
    return resp


def origin_ok(headers) -> bool:
    """#175: the request comes from Dream's own pages. The Host must name this Mac (an IP address, localhost or a
    .local name – a foreign domain is DNS rebinding), and an Origin, if sent, must be the same as the Host: a web page
    of another site open in a browser on this Mac may neither start the paid cloud GPU nor open /ctl with full
    rights. Fail closed."""
    hostport = headers.get("host", "")
    name = hostport.rsplit(":", 1)[0].strip("[]").lower() if not hostport.startswith("[") else hostport[1:].split("]")[0]
    try:
        ipaddress.ip_address(name)
    except ValueError:
        if name != "localhost" and not name.endswith(".local"):
            return False
    origin = headers.get("origin")
    if origin is None:
        return True                                # not sent by a browser page (curl, the stage's own requests)
    return origin.split("://", 1)[-1].rstrip("/").lower() == hostport.lower()


# ---------- WebSockets ----------
def ws_role(sock: WebSocket) -> str | None:
    if not origin_ok(sock.headers):               # #175: a foreign page gets nothing
        return None
    host = sock.client.host if sock.client else None
    return role_of(host, sock.query_params.get("k"), cookie_of(sock.cookies, sock.url.scheme, sock.query_params.get("as") == "eyes",
                                                               sock.query_params.get("as") == "window"))


def ws_can(sock: WebSocket, capability: str) -> bool:
    return can(ws_role(sock), capability)
