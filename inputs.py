"""What steers the dream besides the pages: MIDI controllers, motion sensors over OSC, and the movement the stage
detects (presence, rules)."""
import asyncio
import ipaddress
import json
import os
import secrets
import time

import config
import dance
import hub
import i18n
import midi
import movement
import paths
import playlists
import scenes
import sensors
import settings


async def on_presence(present: bool):
    """Movement (#85): nobody there – the dream calms down; someone comes – a light impulse."""
    await hub.broadcast({"cmd": "wake" if present else "calm"})


# ---------- MIDI controller: faders, knobs and buttons (mappings in ~/.config/dream/midi.json) ----------
midi_map = midi.load_map()
midi_learn: dict = {}
midi_thr, midi_guess = midi.Throttle(), midi.RelativeGuess()


def _midi_ports(names):
    hub.midi_ports[:] = names


midi_listener = midi.Listener(
    lambda key, msg: midi.handle(midi_map, midi_thr, midi_guess, midi_learn, hub.state, key, msg), _midi_ports)
midi_listener.start()


async def midi_loop():
    """~30 times a second: glide towards the controller values (no jumps), fire button actions, report learning."""
    goal: dict = {}
    saved_at, dirty, ports_seen, last_key = 0.0, False, None, ""
    while True:
        await asyncio.sleep(1 / 30)
        pending, actions, learned = midi_thr.take()
        goal.update(pending)
        step = {}
        for k, g in list(goal.items()):
            cur = float(hub.state.get(k, g))
            nxt = g if abs(g - cur) < 0.002 * (midi.TARGETS[k][1] - midi.TARGETS[k][0]) else cur + (g - cur) * 0.5
            step[k] = round(nxt, 4)
            if nxt == g:
                goal.pop(k)
        if step:
            await hub.apply(step, persist=False, by="midi")
            dirty = True
        for a in actions:
            if a == "pause":
                await hub.apply({"running": not hub.state["running"]})
            elif a == "next":
                await scenes.next_scene(force=True)
            elif a == "blackout":
                hub.live["master_before"] = hub.state["master"] if hub.state["master"] > 0.05 else hub.live.get("master_before", 1.0)
                await hub.apply({"master": 0.0 if hub.state["master"] > 0.05 else hub.live["master_before"]})
            elif a == "reseed":
                await hub.apply({"seed": secrets.randbelow(99999) + 1})
            elif a == "restart":
                await hub.broadcast({"cmd": "restart"})
            elif a == "tap":                           # tap tempo: the stage times it
                await hub.broadcast({"cmd": "tap"}, only="stage")
            elif a == "pattern":                       # next music pattern: auto → Pulse → … → Flow → auto
                order = ["auto", *playlists.PATTERNS]
                cur = hub.state.get("music_pattern", "auto")
                await hub.apply({"music_pattern": order[(order.index(cur) + 1) % len(order)] if cur in order else "auto"}, by="midi")
            elif a == "world":                         # #221: the next style world of Dreamy Eyes and the dream windows
                s = hub.state                          # #224: … after the one that shows most, and all of it
                cur = s["world_to"] if s["world_mix"] > 0.5 else s["world"]
                await hub.apply({"world": settings.world_next(cur), "world_mix": 0.0}, by="midi")
            elif a.startswith("dance_"):               # #243: "good"/"bad" for the dance lab – the stage keeps the moment
                await hub.broadcast({"cmd": "dance_fb", "arg": a[6:], "by": "midi"}, only="stage")
            elif a.startswith("fx_"):                  # effects: the stage knows which ones go together
                await hub.broadcast({"cmd": "fx", "arg": a[3:]}, only="stage")
        if learned:
            await hub.broadcast({"midi": {"map": midi_map, "learned": learned}})
        key, at = midi_thr.last
        if ports_seen != hub.midi_ports or (key and key != last_key and time.time() - at < 1):
            ports_seen, last_key = list(hub.midi_ports), key
            await hub.broadcast({"midi": {"ports": hub.midi_ports, "last": key, "error": i18n.msg(midi_listener.error)}})
        if dirty and not goal and time.time() - saved_at > 1:   # save once the hands rest
            hub.save_state()
            saved_at, dirty = time.time(), False


# ---------- motion sensors on the body (phone app, wristband, glove) over OSC, port DREAM_SENSOR_PORT ----------
SENSOR_PORT = int(os.environ.get("DREAM_SENSOR_PORT", "7020"))
sens = sensors.Sensors()


def sensor_setting(msg: dict):
    m = sens.mapping
    forget, invert = (msg.get(k) if isinstance(msg.get(k), str) else None for k in ("sensor_forget", "sensor_invert"))
    if forget in m:                                # #208: a key of the mapping is a text; anything else names nothing
        m.pop(forget)
    if isinstance(m.get(invert), dict):
        m[invert]["invert"] = not m[invert].get("invert")
    if "sensor_impulse" in msg:
        a = msg["sensor_impulse"]
        if isinstance(a, str) and a in sensors.IMPULSE_ACTIONS:
            m["impulse"] = {"action": a}
        else:
            m.pop("impulse", None)
    if "sensor_sens" in msg:
        try:
            sens.sensitivity = m["sensitivity"] = min(3.0, max(0.2, float(msg["sensor_sens"])))
        except (TypeError, ValueError, OverflowError):
            pass
    sensors.save_map(m)


def _private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


async def sensor_loop():
    """Receives sensor OSC (any address with numbers); ~30 times a second hands mapped values to the
    controller glide (shared with MIDI) and turns whips into impulses."""
    from pythonosc.dispatcher import Dispatcher
    from pythonosc.osc_server import AsyncIOOSCUDPServer

    def on_any(client, address, *args):
        if _private(client[0]):                    # only devices at home (and this Mac)
            sens.on_osc(address, args, client[0])

    disp = Dispatcher()
    disp.set_default_handler(on_any, needs_reply_address=True)
    host = "0.0.0.0" if config.LAN else "127.0.0.1"       # a phone on the arm needs dream.sh --lan
    try:
        await AsyncIOOSCUDPServer((host, SENSOR_PORT), disp, asyncio.get_running_loop()).create_serve_endpoint()
        print(f"Sensors over OSC on {host}:{SENSOR_PORT}", flush=True)
    except OSError as e:                           # the port is taken: Dream Control's own sensors still come over /ctl
        print(f"Sensor port {SENSOR_PORT} not available: {e}", flush=True)
    shown_at, told_at, sent = 0.0, 0.0, {}
    while True:
        await asyncio.sleep(1 / 30)
        await sensor_dance()
        if time.monotonic() - told_at > 0.25:      # #249: the register of sources, four times a second
            told_at = time.monotonic()
            await sources_tell()
        for target, value in sens.values(midi.TARGETS).items():
            lo, hi = midi.TARGETS[target]
            if abs(value - sent.get(target, 1e9)) > 0.003 * (hi - lo):   # only real changes
                sent[target] = value
                midi_thr.put(target, value)
        while sens.events:
            ev = sens.events.pop(0)
            if ev[0] == "impulse":
                action = (sens.mapping.get("impulse") or {}).get("action")
                if action in ("flash", "jolt"):
                    await hub.broadcast({"cmd": action, "arg": ev[1]})
                elif action:
                    midi_thr.act(action)
                # the stage shows it, and the phone that was swung gives a little jolt (#240: it never heard of it)
                await hub.broadcast({"sensors": {"impulse": ev[1]}})
            elif ev[0] == "button":                # #235: a wristband's button – the stage decides what it means
                await hub.broadcast({"sensors": {"button": ev[1]}}, only="stage")
            elif ev[0] == "learned":
                await hub.broadcast({"sensors": {"map": sens.mapping, "learned": {"key": ev[1], "target": ev[2]}}})
        if time.time() - shown_at > 0.5 and sens.ch:
            shown_at = time.time()
            await hub.broadcast({"sensors": sens.live()})


SENDER_PHONE = "Dream Control"                     # what ctl.feed_motion names the phone that lends its motion


def sensor_kind(sender: str) -> str:
    """#249: the kind of source a sender of sensor values is – the phone that lends its motion, or a wristband or
    glove (anything that sends OSC)."""
    return "phone" if sender == SENDER_PHONE else "band"


async def sensor_dance():
    """#235: the stage's detection gets the sensor's movement as it comes (~30 times a second, only while a movement
    mode listens to that kind of source and something was sent): the camera and the sensor on the arm confirm each
    other there."""
    m = sens.motion() if movement.uses(hub.state, sensor_kind(sens.source)) else None
    if m:
        await hub.broadcast({"sensors": {"dance": m}}, only="stage")


sources_told: dict = {"msg": None}


async def sources_tell():
    """#249: every sender of sensor values is a source of the register; the list goes to the pages when it changed."""
    now, wall = time.monotonic(), time.time()
    for sender, (at, energy) in list(sens.by.items()):
        if wall - at < 0.5:
            kind = sensor_kind(sender)
            movement.sources.report(f"{kind}:{sender}", kind, sender or "OSC", energy, 0.9, now)
        elif wall - at > movement.GONE:
            sens.by.pop(sender, None)
    msg = movement.msg(hub.state, now)
    if msg != sources_told["msg"]:
        sources_told["msg"] = msg
        await hub.broadcast(msg)


def dance_map(new, mode: str = "dance") -> dict:
    """#235, #249: Dream Control or this Mac changed a mode's mapping table (or asked for the built-in one)."""
    dance.set_rows(new, mode)
    return dance.msg()


# ---------- movement (#85): the stage detects it and reports presence changes and rules ----------
def load_rule_actions() -> dict:
    """Optional ~/.config/dream/motion.json: {"rules": {"<flowtrack rule name>": "next" | {"playlist": "Feuer"} | {"prompt": "…"}}}"""
    try:
        with open(os.path.join(paths.config_dir(), "motion.json")) as f:
            return json.load(f).get("rules", {})
    except (FileNotFoundError, ValueError):
        return {}


async def on_rule(name: str):
    await hub.broadcast({"rule": name})
    action = load_rule_actions().get(name)
    if action == "next":
        await scenes.next_scene(force=True)
    elif isinstance(action, dict):
        await hub.apply({k: v for k, v in action.items() if k in ("playlist", "prompt", "mode", "strength")})
