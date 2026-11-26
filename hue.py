"""Hue lamps dream along (#272): the lamps and rooms chosen of a Philips Hue Bridge take the dream's colour as a mood –
roomlight.colour() (what the audience sees, smoothed and calm: no beat, no flash; the Entertainment API that follows a
beat would be another story), dimmed by a strength of their own and the master fader with its blackout.

Locally only: the bridge's Hue API v2 over https in the home network (`/clip/v2/resource/…`, header
`hue-application-key`) – no cloud, no account. The bridge is an address in the home network, entered or found over mDNS
(`_hue._tcp`, find()). Pairing: the owner presses "Pair" and then the bridge's link button; Dream asks the bridge for an
app key about once a second until it is pressed (POST /api, `generateclientkey`). The key lives only in Dream's config
folder (`hue.json`, mode 0600): never in a log, never in any message to a page (they learn "paired" or not), and it is
sent only to the bridge it belongs to – the bridge's certificate (self-signed, accepted only for a home-network address)
must carry that bridge's id as its name, or nothing is sent (fail closed).

The bridge takes about ten commands a second for lights and one for rooms: every lamp changes at most once a second
and glides there (GLIDE_MS); chosen rooms are sent lamp by lamp while all their lamps fit in that budget, else as the
room (grouped_light). A blackout switches the lamps off at once. When a lamp joins, its state (on, brightness, colour)
is read and kept; when it leaves – unchosen, switched off, the stage silent, another bridge, Dream stops – it gets that
state back. Every request runs beside the event loop with short timeouts and at most IN_FLIGHT at once; a bridge that is
gone or slow is tried again later and slows nothing down."""
import asyncio
import concurrent.futures
import contextlib
import functools
import http.client
import json
import math
import os
import re
import ssl
import time

from cryptography import x509
from cryptography.x509.oid import NameOID

import hub
import mdns
import net
import outbox
import paths
import rights
import roomlight

PORT = 443
SERVICE = "_hue._tcp.local"
TIMEOUT = 2.0                    # seconds for one request to the bridge
DEVICE_TYPE = "dream#mac"        # how the app key is named in the bridge's list (no name of this Mac)
PAIR_SECS, PAIR_EVERY = 30.0, 1.0   # how long Dream waits for the link button, how often it asks meanwhile
TICK = 0.1                       # the sender looks ten times a second …
LAMP_EVERY = 1.0                 # … a lamp changes at most once a second
LAMPS_PER_SEC = 10               # the bridge's budget for lights
GROUP_EVERY = 1.0                # … and for rooms (all of them together)
IN_FLIGHT = 2                    # requests on their way at once (a slow bridge never gets a queue)
GLIDE_MS = 1000                  # the lamp glides to its new colour as long as it waits for the next one
SOFT_MS = 400                    # a blackout, the way back from it, the previous state back
MIN_BRI = 2.0                    # % – a dark picture dims the lamps; only the master or the strength at 0 switch them off
LIST_EVERY = 60.0                # the bridge's lamps and rooms are read again this often
RETRY, RETRY_MAX = 2.0, 30.0     # seconds before a bridge that did not answer is asked again (doubling)
BRIDGE_ID = re.compile(r"[0-9a-f]{16}")
ITEM = re.compile(r"[lg]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

# the colours a lamp can show (CIE xy); Signify's gamuts – a lamp tells its own, a room is taken as C
GAMUTS = {"A": ((0.704, 0.296), (0.2151, 0.7106), (0.138, 0.08)),
          "B": ((0.675, 0.322), (0.409, 0.518), (0.167, 0.04)),
          "C": ((0.6915, 0.3083), (0.17, 0.7), (0.1532, 0.0475))}


# ---------- colour: RGB → CIE xy inside the lamp's gamut ----------
def _linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _cross(o, a, b) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _nearest(p, a, b) -> tuple:
    """The point of the line a–b nearest to p."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return (a[0] + t * dx, a[1] + t * dy)


def into_gamut(p: tuple, gamut: tuple) -> tuple:
    """p itself if the lamp can show it, else the nearest colour on the edge of its triangle."""
    r, g, b = gamut
    s = (_cross(r, g, p), _cross(g, b, p), _cross(b, r, p))
    if all(v >= 0 for v in s) or all(v <= 0 for v in s):
        return p
    return min((_nearest(p, a, c) for a, c in ((r, g), (g, b), (b, r))), key=lambda q: math.dist(p, q))


def xy_of(rgb, gamut: tuple = GAMUTS["C"]) -> tuple | None:
    """The colour of an sRGB colour (r, g, b 0–255) in CIE xy, inside the gamut – None for black (it has no colour)."""
    r, g, b = (_linear(max(0.0, min(255.0, float(c))) / 255) for c in rgb)
    x = 0.4124 * r + 0.3576 * g + 0.1805 * b
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = 0.0193 * r + 0.1192 * g + 0.9505 * b
    if x + y + z < 1e-6:
        return None
    p = into_gamut((x / (x + y + z), y / (x + y + z)), gamut)
    return (round(p[0], 4), round(p[1], 4))


def want_of(rgb, level: float, gamut: tuple | None) -> dict:
    """What a lamp should show: {"on": False} or {"on": True, "bri": %, "xy": (x, y) | None}. The brightness follows
    the picture's (its brightest channel) and the level (strength × master); gamut None: a lamp without colour."""
    if level <= 0.005:
        return {"on": False}
    bri = max(MIN_BRI, min(100.0, 100.0 * level * max(rgb) / 255))
    return {"on": True, "bri": round(bri, 1), "xy": xy_of(rgb, gamut) if gamut else None}


def body_of(want: dict, ms: int) -> dict:
    """The bridge's command for it (PUT /clip/v2/resource/light/<id> or …/grouped_light/<id>)."""
    out = {"on": {"on": bool(want["on"])}, "dynamics": {"duration": int(ms)}}
    if want["on"]:
        out["dimming"] = {"brightness": want["bri"]}
        if want.get("xy"):
            out["color"] = {"xy": {"x": want["xy"][0], "y": want["xy"][1]}}
    return out


def differs(a: dict | None, b: dict) -> bool:
    """Whether a lamp showing a should be told b (small steps are left out: the bridge has more to do)."""
    if a is None or a["on"] != b["on"]:
        return True
    if not b["on"]:
        return False
    if abs(a["bri"] - b["bri"]) >= 1.0:
        return True
    return bool(a.get("xy") and b.get("xy") and math.dist(a["xy"], b["xy"]) >= 0.003)


# ---------- the bridge's lamps and rooms ----------
def _gamut(light: dict) -> tuple | None:
    c = light.get("color")
    if not isinstance(c, dict):
        return None
    g = c.get("gamut")
    with contextlib.suppress(KeyError, TypeError, ValueError):
        return tuple((float(g[k]["x"]), float(g[k]["y"])) for k in ("red", "green", "blue"))
    return GAMUTS.get(c.get("gamut_type"), GAMUTS["C"])


def state_of(light: dict) -> dict:
    """What a lamp shows right now, as it gets it back: on, brightness, its colour or its white."""
    on = light.get("on") if isinstance(light.get("on"), dict) else {}
    dim = light.get("dimming") if isinstance(light.get("dimming"), dict) else {}
    col = light.get("color") if isinstance(light.get("color"), dict) else {}
    ct = light.get("color_temperature") if isinstance(light.get("color_temperature"), dict) else {}
    st = {"on": bool(on.get("on")), "bri": None, "xy": None, "mirek": None}
    with contextlib.suppress(TypeError, ValueError):
        st["bri"] = float(dim["brightness"]) if "brightness" in dim else None
    if ct.get("mirek_valid") and isinstance(ct.get("mirek"), int):
        st["mirek"] = ct["mirek"]                       # it showed a white: that comes back, not a colour
    elif isinstance(col.get("xy"), dict):
        with contextlib.suppress(KeyError, TypeError, ValueError):
            st["xy"] = (float(col["xy"]["x"]), float(col["xy"]["y"]))
    return st


def restore_body(st: dict) -> dict:
    """The command that gives a lamp its previous state back (softly) – also to a lamp that was off: it is switched off
    with its own colour and brightness, so it comes back in them when it is switched on."""
    out = {"on": {"on": st["on"]}, "dynamics": {"duration": SOFT_MS}}
    if st.get("bri"):
        out["dimming"] = {"brightness": st["bri"]}
    if st.get("mirek"):
        out["color_temperature"] = {"mirek": st["mirek"]}
    elif st.get("xy"):
        out["color"] = {"xy": {"x": st["xy"][0], "y": st["xy"][1]}}
    return out


def _data(got) -> list:
    d = got.get("data") if isinstance(got, dict) else None
    return [x for x in d if isinstance(x, dict) and isinstance(x.get("id"), str)] if isinstance(d, list) else []


def _name(x: dict, otherwise: str) -> str:
    m = x.get("metadata") if isinstance(x.get("metadata"), dict) else {}
    return str(m.get("name") or otherwise)[:40]


def catalogue(lights: list, rooms: list, zones: list) -> tuple:
    """The bridge's answer (/clip/v2/resource/light, room, zone) as (items, lamps): items by the id the page and the
    setting hue_lamps_sel use – "l:<light>" a lamp, "g:<room or zone>" a room or zone, {"id", "name", "kind", "colour",
    "lights": [light ids], "group": grouped_light id or None} –, lamps by their id: {"gamut", "state"}."""
    lamps, items, owner = {}, {}, {}
    for li in lights:
        lid = li["id"]
        lamps[lid] = {"gamut": _gamut(li), "state": state_of(li)}
        o = li.get("owner") if isinstance(li.get("owner"), dict) else {}
        owner.setdefault(o.get("rid"), []).append(lid)
        items["l:" + lid] = {"id": "l:" + lid, "name": _name(li, "Hue"), "kind": "light", "colour": lamps[lid]["gamut"] is not None,
                             "lights": [lid], "group": None}
    for kind, groups in (("room", rooms), ("zone", zones)):
        for g in groups:
            kids = [c for c in g.get("children") or [] if isinstance(c, dict)]
            got = [lid for c in kids for lid in (owner.get(c.get("rid"), []) if c.get("rtype") == "device"
                                                  else [c.get("rid")] if c.get("rtype") == "light" and c.get("rid") in lamps else [])]
            grouped = next((s.get("rid") for s in g.get("services") or [] if isinstance(s, dict) and s.get("rtype") == "grouped_light"), None)
            if got:
                items["g:" + g["id"]] = {"id": "g:" + g["id"], "name": _name(g, kind), "kind": kind,
                                         "colour": any(lamps[lid]["gamut"] for lid in got), "lights": list(dict.fromkeys(got)),
                                         "group": grouped if isinstance(grouped, str) else None}
    return {k: v for k, v in items.items() if ITEM.fullmatch(k)}, lamps


def plan(chosen: list, items: dict, lamps: dict) -> list:
    """What is sent for the chosen items: [(rtype, rid, [the lamps it lights], gamut)]. Lamp by lamp while all of them
    fit in the bridge's budget (each lamp in its own gamut), else the rooms as rooms (and the lamps chosen alone that
    are in none of them, lamp by lamp)."""
    picked = [items[c] for c in chosen if c in items]
    every = list(dict.fromkeys(lid for it in picked for lid in it["lights"]))
    if len(every) <= LAMPS_PER_SEC * LAMP_EVERY or not any(it["group"] for it in picked if it["kind"] != "light"):
        return [("light", lid, [lid], lamps[lid]["gamut"]) for lid in every]
    out, covered = [], set()
    for it in picked:
        if it["kind"] != "light" and it["group"]:
            out.append(("grouped_light", it["group"], it["lights"], GAMUTS["C"] if it["colour"] else None))
            covered |= set(it["lights"])
    return out + [("light", lid, [lid], lamps[lid]["gamut"]) for lid in every if lid not in covered]


# ---------- the app key: only in Dream's config folder, mode 0600 ----------
def key_file() -> str:
    return os.path.join(paths.config_dir(), "hue.json")


def load_key() -> dict | None:
    """{"bridge": its id, "key": the app key} – or None (none yet, or a file that is not one)."""
    try:
        with open(key_file()) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    if isinstance(d, dict) and isinstance(d.get("key"), str) and d["key"] and BRIDGE_ID.fullmatch(str(d.get("bridge", ""))):
        return d
    return None


def save_key(bridge: str, key: str, clientkey: str = "") -> None:
    folder = paths.config_dir()
    os.makedirs(folder, exist_ok=True)
    tmp = key_file() + ".tmp"
    with contextlib.suppress(FileNotFoundError):
        os.remove(tmp)
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
        json.dump({"bridge": bridge, "key": key, "clientkey": clientkey}, f)
    os.replace(tmp, key_file())


def forget_key() -> None:
    with contextlib.suppress(FileNotFoundError):
        os.remove(key_file())


# ---------- the bridge's API: https, its own certificate, short timeouts ----------
class Unreachable(Exception):
    """The bridge does not answer (or not in time)."""


class Refused(Exception):
    """Not sent: the address is outside the home network, or the certificate is not the paired bridge's."""


_TLS = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
_TLS.check_hostname = False                      # the bridge's certificate is its own (self-signed): who it is, is
_TLS.verify_mode = ssl.CERT_NONE                 # checked by its name (cert_id) – and only in the home network


def cert_id(raw: bytes | None) -> str:
    """The name in the bridge's certificate – a Hue Bridge's is its id (16 hex digits) – or ""."""
    try:
        names = x509.load_der_x509_certificate(raw).subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        return str(names[0].value).lower() if names else ""
    except (ValueError, TypeError, IndexError):
        return ""


def call(ip: str, method: str, path: str, body=None, key: str | None = None, bridge: str | None = None) -> tuple:
    """One request (blocking: run beside the loop) → (status, JSON). bridge: the id the certificate must carry – every
    request with the key is checked so before a byte of it is sent."""
    if not net.home_address(ip):
        raise Refused("public")
    conn = http.client.HTTPSConnection(ip, PORT, timeout=TIMEOUT, context=_TLS)
    try:
        try:
            conn.connect()
        except OSError as e:
            raise Unreachable(type(e).__name__) from None
        if bridge is not None and cert_id(conn.sock.getpeercert(binary_form=True)) != bridge:
            raise Refused("cert")
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        if key:
            headers["hue-application-key"] = key
        try:
            conn.request(method, path, body=data, headers=headers)
            r = conn.getresponse()
            raw = r.read(4 << 20)
        except (OSError, http.client.HTTPException) as e:
            raise Unreachable(type(e).__name__) from None
        try:
            return r.status, json.loads(raw or b"null")
        except ValueError:
            return r.status, None
    finally:
        conn.close()


pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="hue")   # never the loop's own


async def ask(ip: str, method: str, path: str, body=None, key=None, bridge=None) -> tuple:
    return await asyncio.get_running_loop().run_in_executor(pool, functools.partial(call, ip, method, path, body, key, bridge))


# ---------- what the pages learn (never the key) ----------
status: dict = {"st": "off"}
wake = asyncio.Event()                  # the bridge's address changed, a pairing ended, the key was forgotten
bridge: dict = {}                       # the bridge in use: {"ip", "id", "name", "host"}
pairing: dict = {"task": None, "error": ""}


def _say(**st) -> None:
    """The status to every page that may change it (the panel, Dream Control) – only when it changed."""
    if st == status:
        return
    status.clear()
    status.update(st)
    text = json.dumps(msg(), ensure_ascii=False)
    for c, r in list(hub.roles.items()):
        if rights.can(r, "control"):
            outbox.post(c, text)


def msg() -> dict:
    return {"hue": dict(status)}


def _base(**more) -> dict:
    """What every status tells of the bridge: its address and name, whether Dream is paired with it."""
    return {"host": bridge.get("host", ""), "name": bridge.get("name", ""), "paired": bool(bridge.get("paired")), **more}


def _items_msg(items: dict) -> list:
    order = {"room": 0, "zone": 1, "light": 2}
    return [{k: it[k] for k in ("id", "name", "kind", "colour")}
            for it in sorted(items.values(), key=lambda it: (order[it["kind"]], it["name"].lower(), it["id"]))]


# ---------- the sender ----------
class Sender:
    """The lamps Dream lights right now: what they showed before (to give it back), what each was told last and when,
    the bridge's budget and how the bridge answers."""

    def __init__(self):
        self.bridge = None              # the bridge the lamps below belong to
        self.before: dict = {}          # lamp id → its state before it joined
        self.told: dict = {}            # (rtype, rid) → {"at", "want"}
        self.inflight = 0
        self.light_at = self.group_at = 0.0
        self.fails, self.pause_until = 0, 0.0
        self.unauthorized = False

    def forget(self, bridge_id=None) -> None:
        """Lamps of another bridge, or of a key that is gone: nothing to give back here (what is on its way stays
        counted)."""
        inflight = self.inflight
        self.__init__()
        self.bridge, self.inflight = bridge_id, inflight

    def _done(self, fut, on_ok=None, target=None) -> None:
        self.inflight -= 1
        try:
            code, _ = fut.result()
        except (Exception, asyncio.CancelledError):    # no answer, not in time, or not the paired bridge
            code = 0
        if code in (401, 403):
            self.unauthorized = True
        if 200 <= code < 300:
            self.fails = 0
            if on_ok:
                on_ok()
            return
        if target is not None:
            self.told.pop(target, None)            # not arrived: told again
        if code in (429, 503):                     # the bridge has too much to do: a moment's rest
            self.pause_until = time.monotonic() + 1.0
        elif code == 0:                            # no answer: later, ever more rarely
            self.fails += 1
            self.pause_until = time.monotonic() + min(RETRY * 2 ** (self.fails - 1), RETRY_MAX)

    def _fire(self, ip, key, rtype, rid, body, on_ok=None, target=None) -> None:
        self.inflight += 1
        fut = asyncio.get_running_loop().run_in_executor(
            pool, functools.partial(call, ip, "PUT", f"/clip/v2/resource/{rtype}/{rid}", body, key, self.bridge))
        fut.add_done_callback(lambda f: self._done(f, on_ok, target))

    def step(self, now: float, ip: str, key: str, targets: list, want, leaving: list) -> None:
        """One look (TICK): at most one command for a lamp (the previous state of one that leaves first) and, once a
        second, one for a room – each to the one that waited longest. want(target) → what it should show."""
        if self.inflight >= IN_FLIGHT or now < self.pause_until:
            return
        if now >= self.light_at:
            back = next((lid for lid in leaving if lid in self.before), None)
            if back is not None:
                self.light_at = now + 1 / LAMPS_PER_SEC
                self._fire(ip, key, "light", back, restore_body(self.before[back]), on_ok=lambda lid=back: self._back(lid))
                return
            if self._send(now, ip, key, [t for t in targets if t[0] == "light"], want, LAMP_EVERY):
                self.light_at = now + 1 / LAMPS_PER_SEC
        if now >= self.group_at and self.inflight < IN_FLIGHT:
            if self._send(now, ip, key, [t for t in targets if t[0] == "grouped_light"], want, LAMP_EVERY):
                self.group_at = now + GROUP_EVERY

    def _back(self, lid: str) -> None:
        self.before.pop(lid, None)
        for t in [t for t in self.told if t == ("light", lid)]:
            self.told.pop(t)

    def _send(self, now, ip, key, targets, want, every) -> bool:
        due = []
        for t in targets:
            k, w = (t[0], t[1]), want(t)
            last = self.told.get(k)
            if last is None or (last["want"]["on"] != w["on"]):      # new, or on/off (a blackout): at once
                due.append((-1e9 if last is None else last["at"] - 1e6, k, w, SOFT_MS if last is not None or not w["on"] else GLIDE_MS))
            elif now - last["at"] >= every and differs(last["want"], w):
                due.append((last["at"], k, w, GLIDE_MS))
        if not due:
            return False
        _, k, w, ms = min(due, key=lambda d: d[0])
        self.told[k] = {"at": now, "want": w}
        self._fire(ip, key, k[0], k[1], body_of(w, ms), target=k)
        return True

    def restore_all(self, ip: str, key: str, secs: float = 2.5) -> None:
        """Every lamp gets its previous state back at once (blocking, at most secs: Dream stops, another bridge)."""
        if not self.before or not self.bridge:
            return
        back = concurrent.futures.ThreadPoolExecutor(max_workers=min(10, len(self.before)), thread_name_prefix="hue-back")
        try:
            futs = {back.submit(call, ip, "PUT", f"/clip/v2/resource/light/{lid}", restore_body(st), key, self.bridge): lid
                    for lid, st in self.before.items()}
            done, _ = concurrent.futures.wait(futs, timeout=secs)
            for f in done:
                with contextlib.suppress(Exception):
                    if 200 <= f.result()[0] < 300:
                        self.before.pop(futs[f], None)
        finally:
            back.shutdown(wait=False, cancel_futures=True)


sender = Sender()


def chosen() -> list:
    return [k for k in str(hub.state.get("hue_lamps_sel") or "").split("+") if k]


def level(now: float) -> float:
    amt = max(0.0, min(1.0, float(hub.state.get("hue_lamps_amt", 1.0))))
    return roomlight.light.master(now, hub.state.get("master", 1.0)) * amt


async def _until_wake(secs: float) -> bool:
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(wake.wait(), secs)
    return wake.is_set()


async def keep() -> None:
    """Runs as long as Dream does (server.py): looks after the bridge whose address is entered – its lamps for the
    panel, pairing, and the light while the switch is on and the stage tells its colour."""
    retry = RETRY
    while True:
        wake.clear()
        host = hub.state.get("hue_bridge") or ""
        if not host:
            bridge.clear()
            _say(st="nohost")
            await wake.wait()
            continue
        if bridge.get("host") != host:
            bridge.clear()
            bridge["host"] = host
        _say(st="looking", host=host)
        ip = await net.resolve(host)
        if wake.is_set():
            continue
        if not ip:
            _say(st="unknown", host=host)
            await _until_wake(retry)
            retry = min(retry * 2, RETRY_MAX)
            continue
        if not net.home_address(ip):
            _say(st="public", host=host)
            await wake.wait()
            continue
        try:
            await session(host, ip)
            retry = RETRY
        except Unreachable:
            _say(**_base(st="down"))
            await _until_wake(retry)
            retry = min(retry * 2, RETRY_MAX)
        except Refused:
            _say(**_base(st="cert"))
            await _until_wake(RETRY_MAX)
        except Exception as e:                     # never the end of the lamps for the rest of the show
            print("hue:", type(e).__name__, flush=True)    # (never the text: it could carry an answer of the bridge)
            _say(**_base(st="down"))
            await _until_wake(retry)
            retry = min(retry * 2, RETRY_MAX)


async def session(host: str, ip: str) -> None:
    """One bridge until its address changes: who it is, pairing, its lamps, the light."""
    code, cfg = await ask(ip, "GET", "/api/0/config")
    bid = str(cfg.get("bridgeid") or "").lower() if isinstance(cfg, dict) else ""
    if code != 200 or not BRIDGE_ID.fullmatch(bid):
        bridge.update(ip=ip, id="", name="")
        _say(st="notbridge", host=host)
        await _until_wake(RETRY_MAX)
        return
    bridge.update(ip=ip, id=bid, name=str(cfg.get("name") or "Hue Bridge")[:40], host=host)
    if sender.bridge != bid:
        sender.forget(bid)                         # the lamps of another bridge cannot be given back here
    creds = load_key()
    bridge["paired"] = bool(creds and creds["bridge"] == bid)
    if not bridge["paired"]:
        if not (pairing["task"] and not pairing["task"].done()):
            _say(**_base(st="unpaired", **({"error": pairing["error"]} if pairing["error"] else {})))
        await wake.wait()                          # pair() ends with wake
        return
    key = creds["key"]
    try:
        await light(ip, key)
    finally:
        if wake.is_set() and sender.before:        # another bridge, or forgotten: the lamps get their state back first
            await asyncio.to_thread(sender.restore_all, ip, key)


async def _catalogue(ip: str, key: str) -> tuple:
    got = []
    for kind in ("light", "room", "zone"):
        code, d = await ask(ip, "GET", f"/clip/v2/resource/{kind}", key=key, bridge=sender.bridge)
        if code in (401, 403):
            sender.unauthorized = True
            return {}, {}
        if code != 200:
            raise Unreachable(str(code))
        got.append(_data(d))
    return catalogue(*got)


async def light(ip: str, key: str) -> None:
    """The lamps of a paired bridge: the list for the panel, and the light while it is on."""
    items, lamps = await _catalogue(ip, key)
    listed = time.monotonic()
    while not wake.is_set():
        now = time.monotonic()
        if sender.unauthorized:                    # the bridge no longer knows the key (deleted in the Hue app)
            forget_key()
            sender.forget(sender.bridge)
            pairing["error"] = "revoked"
            wake.set()
            return
        if now - listed > LIST_EVERY:
            with contextlib.suppress(Unreachable):
                items, lamps = await _catalogue(ip, key)
            listed = time.monotonic()
        on, fresh = bool(hub.state.get("hue_lamps")), roomlight.light.fresh(now)
        targets = plan(chosen(), items, lamps) if on and fresh else []
        lit = {lid for t in targets for lid in t[2]}
        new = [lid for lid in lit if lid not in sender.before]
        if new and now >= sender.pause_until:      # lamps that join: what they show now is kept (read fresh)
            try:
                code, d = await ask(ip, "GET", "/clip/v2/resource/light", key=key, bridge=sender.bridge)
            except Unreachable:
                code, d = 0, None
            if code == 200:
                now_lamps = {x["id"]: x for x in _data(d)}
                for lid in new:
                    sender.before[lid] = state_of(now_lamps[lid]) if lid in now_lamps else lamps[lid]["state"]
            else:
                sender.fails += 1
                sender.pause_until = time.monotonic() + min(RETRY * 2 ** (sender.fails - 1), RETRY_MAX)
        targets = [t for t in targets if all(lid in sender.before for lid in t[2])]
        leaving = [lid for lid in sender.before if lid not in lit]
        st = "live" if targets else "wait" if on and chosen() and not fresh else "ready"
        _say(**_base(st="down" if sender.fails >= 3 else st, lamps=_items_msg(items),
                     **({"n": len({lid for t in targets for lid in t[2]})} if st == "live" else {})))
        if targets or leaving:
            rgb, lv = roomlight.light.colour(now), level(now)
            sender.step(now, ip, key, targets, lambda t: want_of(rgb, lv, t[3]), leaving)
        await _until_wake(TICK)


# ---------- pairing ----------
async def pair() -> None:
    """The owner pressed "Pair": Dream asks the bridge for an app key about once a second until its link button is
    pressed (error 101 until then), for PAIR_SECS at most."""
    ip, bid = bridge.get("ip"), bridge.get("id")
    if not ip or not bid or (pairing["task"] and not pairing["task"].done()):
        return
    pairing["task"] = asyncio.current_task()
    pairing["error"] = ""
    end, err = time.monotonic() + PAIR_SECS, "noanswer"
    try:
        while True:
            left = end - time.monotonic()
            _say(**_base(st="pairing", left=max(0, math.ceil(left))))
            try:
                code, got = await ask(ip, "POST", "/api", {"devicetype": DEVICE_TYPE, "generateclientkey": True}, bridge=bid)
            except (Unreachable, Refused):
                code, got = 0, None
            first = got[0] if isinstance(got, list) and got and isinstance(got[0], dict) else {}
            ok = first.get("success") if isinstance(first.get("success"), dict) else None
            if ok and isinstance(ok.get("username"), str) and ok["username"]:
                save_key(bid, ok["username"], str(ok.get("clientkey") or ""))
                print("hue: paired with the bridge", flush=True)
                return
            if isinstance(first.get("error"), dict):
                err = "nobutton" if first["error"].get("type") == 101 else "refused"
            if left <= 0:
                pairing["error"] = err
                return
            await asyncio.sleep(min(PAIR_EVERY, max(left, 0.05)))
    finally:
        pairing["task"] = None
        wake.set()


def unpair() -> None:
    """Forget the key. The session ends with it and gives the lamps their state back first (it still holds the key)."""
    forget_key()
    pairing["error"] = ""
    wake.set()


def stop() -> None:
    """Dream stops (server.py): the lamps that dream along get their previous state back at once."""
    key = load_key()
    if key and bridge.get("ip") and key["bridge"] == sender.bridge:
        sender.restore_all(bridge["ip"], key["key"])


async def find() -> list:
    """The Hue Bridges in the network, found in about two seconds beside the loop."""
    return await asyncio.get_running_loop().run_in_executor(None, mdns.browse, SERVICE, 2.0)


def sync() -> None:
    """The bridge's address changed (hub.on_change): the session starts again."""
    wake.set()


hub.on_change("hue_bridge", sync)
