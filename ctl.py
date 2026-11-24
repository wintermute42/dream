"""The control line /ctl: the stage and every remote, Dreamy Eyes included, talk to Dream over it. What a device may
say is decided here by its role (rights.py) – never only in the page. Also the live feeds a device lends: its camera
and its motion sensors (#146)."""
import asyncio
import contextlib
import json
import math
import os
import time

from fastapi import WebSocket, WebSocketDisconnect

import cloud
import config
import dance
import eyes
import hub
import i18n
import inputs
import measure
import media
import midi
import outbox
import rights
import scenes
import settings
import windows
from web import app


@app.websocket("/ctl")
async def ctl(sock: WebSocket):
    if not rights.ws_can(sock, "ctl"):             # #201: a dream window only looks (/view)
        await sock.close(code=4403)
        return
    await sock.accept()
    outbox.box(sock)
    if not hub.live.get("loop"):                       # the background loops start with the first client
        hub.live["loop"] = asyncio.create_task(scenes.scene_loop())
        hub.live["midi"] = asyncio.create_task(inputs.midi_loop())
        hub.live["sensors"] = asyncio.create_task(inputs.sensor_loop())
        hub.live["aimask"] = asyncio.create_task(eyes.aimask_loop())   # #160
        hub.live["worlds"] = asyncio.create_task(eyes.world_loop())    # #224
    key_role = rights.ws_role(sock)
    role = key_role
    if role == "control" and "control" in hub.roles.values():
        role = "guest"                             # #148: one Dream Control at a time; this one may take over
    kind = "stage" if sock.query_params.get("role") == "stage" and rights.can(key_role, "stage") else "remote"
    hub.clients[sock] = kind
    hub.roles[sock], hub.key_roles[sock] = role, key_role
    if sock.query_params.get("as") == "eyes" and rights.can(key_role, "eyes"):   # by its key, not its turn
        eyes.eyes_pages.add(sock)                       # #166: a Dreamy Eyes page, whatever key it came with
    lang = i18n.from_cookie(sock.cookies.get("dream-lang"))
    i18n.current.set(lang)
    if kind == "stage" and lang:                   # #132: what all see (MIDI, cloud) speaks the stage's language
        i18n.fallback["lang"] = lang
    outbox.post(sock, json.dumps(role_msg(sock)))
    outbox.post(sock, json.dumps(feeds_msg(sock) if not rights.can(role, "eyes_only") else {"feeds_mine": [], **eyes.aimask_msg()}))
    if sock in eyes.eyes_pages and not rights.can(role, "eyes_only"):   # #166: a Dreamy Eyes page on a Control device gets the faces too
        outbox.post(sock, json.dumps(eyes.aimask_msg()))
    if sock in eyes.eyes_pages or rights.can(role, "eyes_only"):   # #230: where the painted faces have their eyes, brows, mouth
        windows.marks_greet(sock)
    if sock in eyes.eyes_pages or rights.can(role, "eyes"):   # #172: how often the trance may come
        outbox.post(sock, json.dumps({"eyes_cfg": eyes.eyes_cfg, **eyes.world_msg()}))   # … and the style world (#221)
    if rights.can(role, "control") and cloud.cloud_cache["st"]:   # #176: the cloud's latest status
        outbox.post(sock, json.dumps({"cloud": cloud.cloud_cache["st"]}))
    if not rights.can(role, "eyes_only"):
        outbox.post(sock, json.dumps({"midi": {"map": inputs.midi_map}}))
        outbox.post(sock, json.dumps({"sensors": {"map": inputs.sens.mapping}}))
        # #235: the dance mapping table; #243: whether the dance lab is open, records or plays
        outbox.post(sock, json.dumps({"dance": {**dance.msg()["dance"], "lab": hub.live.get("dance_lab") or {}}}))
        outbox.post(sock, json.dumps({"state": hub.state, "playlists": scenes.playlist_names(), "gallery": media.gallery_list(),
                                         "cams": hub.live.get("cams", []), "lan": config.LAN,
                                         "schema": settings.page_schema(), "worlds": list(settings.WORLDS),   # #224: the band of worlds
                                         **eyes.drift_msg(time.monotonic()), **hub.status_msg()}, ensure_ascii=False))
    await hub.broadcast(hub.status_msg())
    bucket = [20.0, time.monotonic()]              # #175: a guest's message allowance
    try:
        while True:
            raw = await sock.receive()
            if raw.get("type") == "websocket.disconnect":
                break
            if raw.get("bytes") is not None:      # #146: a picture of the live camera (only its device's)
                await feed_frame(sock, raw["bytes"])
                continue
            try:
                msg = json.loads(raw.get("text") or "null")
            except (ValueError, RecursionError):   # #208: not JSON, or nested too deep – not taken, the line stays
                continue
            if not isinstance(msg, dict):
                continue
            if sock in eyes.eyes_pages or rights.can(hub.roles.get(sock), "eyes_only"):   # #166: also eyes on a Control device
                eyes.eyes_note(msg)
                if msg.get("eyes_mood") in windows.WINDOW_MOODS:  # #201: the dream windows feel with the eyes
                    await windows.windows_mood(msg["eyes_mood"])
            mr = msg.get("measure_report")             # #180: a device's frames during a measurement run
            if measure.measure["run"] and isinstance(mr, dict) and len(measure.measure["reports"]) < 50:
                kind = mr.get("kind") if mr.get("kind") in ("stage", "eyes", "remote", "output") else "other"
                with contextlib.suppress(TypeError, ValueError, OverflowError):
                    measure.measure["reports"][(kind, id(sock))] = {
                        **{k: float(min(max(float(mr.get(k) or 0), 0), 10000)) for k in ("fps", "ms_avg", "ms_p95", "slow_pct")},
                        "render": mr.get("render") if mr.get("render") in ("webgl2", "canvas") else "",
                        # #205: the stage's share of pictures that came with a flow field, and what a field cost
                        **{k: float(min(max(float(mr[k]), 0), 10000)) for k in ("flow_pct", "flow_ms") if k in mr}}
            if rights.can(hub.roles.get(sock), "eyes_only"):  # #156: Dreamy Eyes only lends (or stops) its front camera
                f = msg.get("feed")
                msg = {"feed": {"cam": bool(f.get("cam")), "facing": "user"}} if isinstance(f, dict) and "cam" in f else {}
            if msg.get("feed_end") in ("cam", "motion") and rights.can(hub.roles.get(sock), "control"):
                await feed_end_other(sock, msg["feed_end"])
            if "feed" in msg and isinstance(msg["feed"], dict):
                await feed_set(sock, msg["feed"])
            if "motion_in" in msg and feeds["motion"] is sock and isinstance(msg["motion_in"], dict):
                feed_motion(msg["motion_in"])
            if rights.can(hub.roles.get(sock), "control"):    # #172: Dream Control sends the eyes into trance / sets how often
                if msg.get("eyes_trance") is True:
                    await eyes.eyes_send({"trance": True})
                ec = msg.get("eyes_cfg")
                if isinstance(ec, dict) and ec.get("trance_every") in eyes.TRANCE_CHOICES:
                    eyes.eyes_cfg["trance_every"] = ec["trance_every"]
                    with contextlib.suppress(OSError):
                        os.makedirs(hub.STATE_DIR, exist_ok=True)
                        with open(eyes.EYES_CFG_FILE, "w") as f:
                            json.dump(eyes.eyes_cfg, f)
                    await eyes.eyes_send({"eyes_cfg": eyes.eyes_cfg}, also_control=True)
            if msg.get("take_control") and rights.can(hub.key_roles.get(sock), "take_over"):
                await take_control(sock)
            if msg.get("renew_guest") and rights.can(key_role, "stage"):
                await renew_guest()
            if rights.can(hub.roles.get(sock), "set:guest"):  # #148: a guest steers only the safe settings
                now_m = time.monotonic()           # #175: and not faster than about 20 messages a second
                bucket[0] = min(20.0, bucket[0] + (now_m - bucket[1]) * 20); bucket[1] = now_m
                if bucket[0] < 1:
                    continue
                bucket[0] -= 1
                msg = {k: v for k, v in msg.items() if k in ("set", "cmd", "auto")}
                if isinstance(msg.get("set"), dict):
                    msg["set"] = settings.guest_changes(msg["set"])
                if not is_name(msg.get("cmd")) or msg["cmd"] not in rights.GUEST_CMDS:
                    msg.pop("cmd", None)
            if msg.get("reset") in (True, "undo") and rights.can(hub.roles.get(sock), "set:all"):   # #216: never a guest
                await (hub.reset_undo() if msg["reset"] == "undo" else hub.reset())
            if "set" in msg and isinstance(msg["set"], dict):
                await hub.apply(msg["set"], exclude=sock, by=None if msg.get("auto") else kind)
            if is_name(msg.get("cmd")):            # one-off actions, handled by the stage
                if msg["cmd"] == "next":
                    await scenes.next_scene(force=True)
                else:
                    await hub.broadcast({"cmd": msg["cmd"], "arg": msg.get("arg")}, exclude=sock)
            if "midi_learn" in msg:                # the next touched MIDI control gets this target
                t = msg["midi_learn"]
                inputs.midi_learn.clear()
                if is_name(t) and (t in midi.TARGETS or t in midi.ACTIONS):
                    inputs.midi_learn["target"] = t
            if is_name(msg.get("sensor_learn")) and msg["sensor_learn"] in midi.TARGETS:
                inputs.sens.start_learning(msg["sensor_learn"])
            if "sensor_forget" in msg or "sensor_invert" in msg or "sensor_impulse" in msg or "sensor_sens" in msg:
                inputs.sensor_setting(msg)
                await hub.broadcast({"sensors": {"map": inputs.sens.mapping}})
            if isinstance(msg.get("dance_lab"), dict) and kind == "stage":   # #243: the lab's state, for Dream Control's card
                lab = {k: bool(msg["dance_lab"].get(k)) for k in ("open", "rec", "play")}
                hub.live["dance_lab"] = lab
                await hub.broadcast({"dance": {"lab": lab}}, exclude=sock)
            if "dance_map" in msg and rights.can(hub.roles.get(sock), "control"):   # #235: never a guest
                await hub.broadcast(inputs.dance_map(msg["dance_map"]))
            if "midi_forget" in msg:
                inputs.midi_map.pop(str(msg["midi_forget"]), None)
                midi.save_map(inputs.midi_map)
                await hub.broadcast({"midi": {"map": inputs.midi_map}})
            if "cams" in msg and kind == "stage" and isinstance(msg["cams"], list):   # the Mac's cameras, by name
                hub.live["cams"] = [str(c)[:200] for c in msg["cams"][:12]]
                await hub.broadcast({"cams": hub.live["cams"]}, exclude=sock)
            if "moved" in msg and kind == "stage" and hub.state["flowtrack"] != "off":   # movement: someone came or left
                if hub.state["motion"]:
                    await inputs.on_presence(bool(msg["moved"]))
            if "rule" in msg and kind == "stage" and hub.state["flowtrack"] != "off":
                for name in msg["rule"] if isinstance(msg["rule"], list) else [msg["rule"]]:
                    await inputs.on_rule(str(name)[:60])
            if isinstance(msg.get("live"), dict) and kind == "stage":   # the stage reports fps
                lv = msg["live"]
                hub.live["fps"] = rate(lv.get("fps"), hub.live["fps"])
                hub.live["flow_rate"] = rate(lv.get("flow_rate"), 0.0)
                await hub.broadcast(hub.status_msg())
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        if kind == "stage":
            hub.live.pop("dance_lab", None)        # #243: the lab is the stage's – gone with it
        hub.clients.pop(sock, None)
        hub.roles.pop(sock, None)
        hub.key_roles.pop(sock, None)
        eyes.eyes_pages.discard(sock)
        outbox.drop(sock)
        await feeds_end(sock)
        await hub.broadcast(hub.status_msg())


def is_name(v) -> bool:
    """#208: a command, a target, a key is a text. Anything else a device sends in its place (a list, a number) is not
    looked up anywhere – a value that cannot be hashed would end the device's connection."""
    return isinstance(v, str)


def rate(v, default: float) -> float:
    """#208: a rate the stage reports (pictures a second): a finite number that is not negative, else the default."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return default
    try:
        v = float(v)
    except OverflowError:
        return default
    return v if math.isfinite(v) and v >= 0 else default


def role_msg(sock) -> dict:
    """#148: what this client may do; a second Dream Control may take over from the first."""
    role = hub.roles.get(sock)
    return {"role": role, "can_take": rights.can(hub.key_roles.get(sock), "take_over") and role != "control",
            "can": sorted(rights.ROLES[role].can) if role in rights.ROLES else []}


async def take_control(sock):
    """#148: this Dream Control takes over; the one before goes on as a guest (and may take it back)."""
    for c, r in list(hub.roles.items()):
        if r == "control" and c is not sock:
            hub.roles[c] = "guest"
            await feeds_end(c)                     # #146: its camera and motion end with its rights
            outbox.post(c, json.dumps({**role_msg(c), "taken": True}))
    hub.roles[sock] = "control"
    outbox.post(sock, json.dumps(role_msg(sock)))


# ---------- #146: live camera and motion of the Dream Control device ----------
feeds: dict = {"cam": None, "motion": None}   # the one device that sends its live camera / its motion
feed_info: dict = {}        # kind -> what the stage shows about it ({"facing": "user" | "environment"})


def feeds_msg(sock=None) -> dict:
    """What the stage shows (who sends what) and, for one device, which feeds are its own."""
    msg = {"feeds": {k: ({"by": "Dream Control", **feed_info.get(k, {})} if c else None) for k, c in feeds.items()}}
    if sock is not None:
        msg["feeds_mine"] = [k for k, c in feeds.items() if c is sock]
    return msg


async def feeds_changed():
    for c in list(hub.clients):
        msg = feeds_msg(c)
        if rights.can(hub.roles.get(c), "eyes_only"):
            msg = {"feeds_mine": [k for k, o in feeds.items() if o is c]}
        outbox.post(c, json.dumps(msg))


async def feed_set(sock, want: dict):
    """{"cam": true, "facing": "environment"} / {"cam": false} / {"motion": true|false}: only Dream Control or this
    Mac may send a live feed; a newer one takes over (the device before is told)."""
    if not rights.can(hub.roles.get(sock), "feed"):
        return
    changed = False
    for kind in ("cam", "motion"):
        if kind not in want:
            continue
        if want[kind]:
            old = feeds[kind]
            feeds[kind] = sock
            by = "Dreamy Eyes" if rights.can(hub.roles.get(sock), "eyes_only") else "Dream Control"
            feed_info[kind] = ({"by": by, "facing": "user" if want.get("facing") == "user" else "environment"}
                               if kind == "cam" else {"by": by})
            if old is not None and old is not sock:
                outbox.post(old, json.dumps({"feed_taken": kind}))
            if kind == "cam" and (hub.state["mode"] != "cam" or hub.state["cam_device"] != "device"):
                await hub.apply({"mode": "cam", "cam_device": "device"}, by="remote")
            changed = True
        elif feeds[kind] is sock:
            await feed_stop(kind)
            changed = True
    if changed:
        await feeds_changed()


async def feed_stop(kind: str):
    feeds[kind] = None
    feed_info.pop(kind, None)
    if kind == "cam" and hub.state["cam_device"] == "device":   # never falls back to the Mac's camera by itself
        await hub.apply({"cam_device": "", **({"mode": "dream"} if hub.state["mode"] == "cam" else {})}, by="remote")


async def feed_end_other(sock, kind: str):
    """#156: Dream Control (or this Mac) ends a feed another device sends – e.g. the Dreamy Eyes' camera."""
    owner = feeds[kind]
    if owner is None or owner is sock:
        return
    await feed_stop(kind)
    outbox.post(owner, json.dumps({"feed_taken": kind}))
    await feeds_changed()


async def feeds_end(sock):
    ended = [k for k, c in feeds.items() if c is sock]
    for kind in ended:
        await feed_stop(kind)
    if ended:
        await feeds_changed()


MAX_FRAME = 1024 * 1024


async def feed_frame(sock, data: bytes):
    """A JPEG of the device's camera, passed on to the stage(s) as it is; nothing is kept – #219: no copy for a
    portrait either, whoever lends the camera."""
    if feeds["cam"] is not sock or not data or len(data) > MAX_FRAME or data[:2] != b"\xff\xd8":
        return
    for c, kind in list(hub.clients.items()):
        if kind == "stage" and not outbox.post_frame(c, data):   # #187: the latest picture only, never waited for
            hub.clients.pop(c, None)


MOTION_ADDR = {"acc": "/device/accelerometer", "lin": "/device/linear_acceleration",
               "gyro": "/device/gyroscope", "ori": "/device/orientation"}


def feed_motion(m: dict):
    """The device's motion sensors become sensor channels like OSC (#105): learning and strikes work the same."""
    for k, addr in MOTION_ADDR.items():
        v = m.get(k)
        if isinstance(v, list) and 0 < len(v) <= 4:
            inputs.sens.on_osc(addr, v, "Dream Control")


async def renew_guest():
    """#148: a new guests' key: everyone in with the old one is out and needs the new QR code."""
    rights.renew_key("guest")
    for c, r in list(hub.key_roles.items()):
        if r == "guest":
            hub.key_roles.pop(c, None)
            with contextlib.suppress(Exception):
                await c.close(code=4403)
    await hub.broadcast({"guest_renewed": True})
