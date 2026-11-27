"""What steers the dream besides the pages: MIDI controllers, motion sensors over OSC, the rules of the movement the
stage detects, and whether someone is there in front of Dreamy Eyes."""
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
import outbox
import paths
import playlists
import receiver
import rights
import scenes
import sensors
import settings
import wearables


async def on_presence(word: str):
    """Nobody in front of Dreamy Eyes – the dream calms down ("calm"); someone comes – a light impulse ("wake"); no
    eyes report any more – the calm ends quietly ("rest"). Never from the Mac's camera (movement.Presence)."""
    await hub.broadcast({"cmd": word})


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
                await hub.blackout()
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
            elif a == "clutch":                        # #251: the dance's clutch, in or out
                await hub.apply({"clutch": not hub.state["clutch"]}, by="midi")
            elif a == "dance_set":                     # #251: the next movement set, round and round
                await hub.apply({"dance_set": next_set(hub.state["dance_set"])}, by="midi")
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
# #277: the devices worn on the body that speak Dream's own protocol (a StickS3): their motion goes into the
# sensor input like any OSC sender's, their button is the clutch
wear = wearables.Wearables(feed=lambda address, values, source, t, unit: sens.on_osc(address, values, source, now=t, gyro_unit=unit))
wear.clutch = bool(hub.state["clutch"])
hub.on_change("clutch", lambda: wear.tell_all(hub.state["clutch"]))   # whoever moved the clutch: the devices hear it
wear.radio_for = receiver.channel_for     # #278: a stick on the Wi-Fi whose USB receiver is plugged in moves to the radio


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


def wear_packet(client, address, *args):
    """#277: a packet of a StickS3 – only from the home network (and this Mac), like every sensor."""
    if _private(client[0]):
        wear.on_osc(address, args, client)


async def sensor_loop():
    """Receives sensor OSC (any address with numbers); ~30 times a second hands mapped values to the
    controller glide (shared with MIDI) and turns whips into impulses."""
    from pythonosc.dispatcher import Dispatcher
    from pythonosc.osc_server import AsyncIOOSCUDPServer

    def on_any(client, address, *args):
        if _private(client[0]):                    # only devices at home (and this Mac)
            sens.on_osc(address, args, client[0])

    disp = Dispatcher()
    disp.map(wearables.PREFIX + "*", wear_packet, needs_reply_address=True)
    disp.set_default_handler(on_any, needs_reply_address=True)
    host = "0.0.0.0" if config.LAN else "127.0.0.1"       # a phone on the arm needs dream.sh --lan
    try:
        wear.transport, _ = await AsyncIOOSCUDPServer((host, SENSOR_PORT), disp, asyncio.get_running_loop()).create_serve_endpoint()
        print(f"Sensors over OSC on {host}:{SENSOR_PORT}", flush=True)
        if config.LAN:                             # #277: the worn devices find the port over mDNS
            await wearables.advertise(SENSOR_PORT)
    except OSError as e:                           # the port is taken: Dream Control's own sensors still come over /ctl
        print(f"Sensor port {SENSOR_PORT} not available: {e}", flush=True)
    # #278: the USB receiver – the sticks by radio; a stick's second button is an ordinary sensor button there too
    hub.live["receiver"] = asyncio.create_task(receiver.watch(wear, other=lambda address, args, src: sens.on_osc(address, args, src)))
    shown_at, told_at, sent = 0.0, 0.0, {}
    while True:
        await asyncio.sleep(1 / 30)
        await sensor_dance()
        wear.ping_all()                            # #278: the delay of every worn device, once a second each
        receiver.tick(bool(hub.state["clutch"]))   # … and the receiver's LED
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
        await wear_events()
        if time.time() - shown_at > 0.5 and sens.ch:
            shown_at = time.time()
            await hub.broadcast({"sensors": sens.live()})


# what ctl.feed_motion names the phones that lend their motion: Dream Control, and (#237) a second phone that stands by
SENDER_PHONES = ("Dream Control", "Dream Control 2")


def sensor_kind(sender: str) -> str:
    """#249: the kind of source a sender of sensor values is – a phone that lends its motion, or a wristband or
    glove (anything that sends OSC)."""
    return "phone" if sender in SENDER_PHONES else "band"


def glow_arms(now: float | None = None) -> dict:
    """#237: the motion of every phone that glows as a light marker, by the hand whose marker has its colour –
    {"l": {"g": gyroscope, "age": seconds}, "r": …}: the stage's detection holds each against the spot of light it
    sees for that hand."""
    arms = {}
    for sender in movement.glows.by:
        hand, arm = movement.glows.hand(hub.state, sender), sens.arm(sender, now)
        if hand and arm:
            arms[hand] = arm
    return arms


async def sensor_dance():
    """#235: the stage's detection gets the sensor's movement as it comes (~30 times a second, only while a movement
    mode listens to that kind of source and something was sent): the camera and the sensor on the arm confirm each
    other there."""
    m = sens.motion() if movement.uses(hub.state, sensor_kind(sens.source)) else None
    raw = sens.take_raw()                          # #196: the raw values since the last step, for the lab's sessions
    if m:
        m["r"] = raw
        arms = glow_arms() if movement.uses(hub.state, "phone") else {}
        await hub.broadcast({"sensors": {"dance": {**m, **({"arms": arms} if arms else {})}}}, only="stage")


async def wear_events():
    """#277: a StickS3's button – the clutch as the dancer wants it, like a MIDI button or key K (hub.apply; the devices
    hear the result through the watcher of "clutch", the one that pressed too when nothing changed). #278: the USB
    receiver's button says no state – it turns the clutch the other way (on None)."""
    while wear.events:
        _, on, id_ = wear.events.pop(0)
        if on is None:
            on = not hub.state["clutch"]
        if hub.state["clutch"] != on:
            wear_told["msg"] = None                # the panel learns of the press before the clutch moves
            wear_tell()
            await hub.apply({"clutch": on}, by="receiver" if id_.startswith("receiver:") else "wear")
        else:
            wear.tell_all(on)


def wear_msg() -> dict:
    msg = wear.msg(SENSOR_PORT, config.LAN)
    msg["wear"]["receivers"] = receiver.listing()      # #278: the USB receivers (never a port's path or a key)
    return msg


wear_told: dict = {"msg": None}


def wear_tell() -> None:
    """#277: the worn devices to the pages that may allow them (the panel, Dream Control) – when something changed."""
    msg = wear_msg()
    if msg == wear_told["msg"]:
        return
    wear_told["msg"] = msg
    text = json.dumps(msg)
    for c, r in list(hub.roles.items()):
        if rights.can(r, "control"):
            outbox.post(c, text)


def wear_op(op) -> None:
    """#277: {"op": "allow" | "revoke", "id": …} – only from the panel or Dream Control (ctl.py checks the role).
    #278: {"op": "pairing", "id": <a receiver's id>} – that receiver opens its pairing window."""
    if isinstance(op, dict) and op.get("op") in ("allow", "revoke", "pairing"):
        if op["op"] == "pairing":
            receiver.open_pairing(op.get("id"))
        else:
            (wear.allow if op["op"] == "allow" else wear.revoke)(op.get("id"))
        wear_told["msg"] = None
        wear_tell()


sources_told: dict = {"msg": None}


async def sources_tell():
    """#249: every sender of sensor values is a source of the register; the list goes to the pages when it changed."""
    now, wall = time.monotonic(), time.time()
    for sender, (at, energy) in list(sens.by.items()):
        if wall - at < 0.5:
            kind = sensor_kind(sender)
            movement.sources.report(f"{kind}:{sender}", kind, sender or "OSC", energy, 0.9, now)
        elif wall - at > movement.GONE:
            sens.forget(sender)
    wear_tell()
    msg = movement.msg(hub.state, now)
    if msg != sources_told["msg"]:
        sources_told["msg"] = msg
        await hub.broadcast(msg)
    word = movement.presence.step(msg["move"]["sources"], now)
    if word:
        await on_presence(word)


def next_set(name: str) -> str:
    """#251: the movement set after this one in the list (the MIDI button), starting from the one in use."""
    names = list(dance.all_slots())
    name = dance.slot_use if dance.slot_use in names else name
    return names[(names.index(name) + 1) % len(names)] if name in names else names[0]


def _set_chosen() -> None:
    """#251: a movement set was chosen – in the panel, by a MIDI button, by a playlist scene: its sentences are the
    dance's table from now on (#265), and every page is told. A name that is no set changes nothing."""
    if dance.use_slots(hub.state["dance_set"]):
        try:
            asyncio.get_running_loop().create_task(hub.broadcast(dance.msg()))
        except RuntimeError:                       # no loop (a script, a test): the next page that connects is told
            pass


hub.on_change("dance_set", _set_chosen)


def dance_slots(op) -> dict:
    """#265: Dream Control or this Mac changes the sets: {"op": "draft", "name", "slots"} (a change, played at once,
    not kept yet – a built-in set too), {"op": "discard", "name"}, {"op": "save", "name"} (an own set keeps its draft),
    {"op": "save_as", "name": the new name, "slots", "from": the set it came from} (a new set of one's own, in use from
    now on – also the undo of a deletion), {"op": "rename", "name", "as"}, {"op": "delete", "name"} (own sets only).
    A built-in set is never changed – whatever a page sends. The set in use is the setting dance_set too."""
    if isinstance(op, dict):
        name, what = op.get("name"), op.get("op")
        if what == "draft":
            dance.draft_slots(name, op.get("slots"))
        elif what == "discard":
            dance.discard_slots(name)
        elif what == "save":
            dance.save_slots(name)
        elif what == "save_as":
            dance.save_slots_as(name, op.get("slots"), op.get("from"))
        elif what == "rename":
            dance.rename_slots(name, op.get("as"))
        elif what == "delete":
            dance.delete_slots(name)
        if hub.state.get("dance_set") != dance.slot_use:
            hub.state["dance_set"] = dance.slot_use
    return {**dance.msg(), "set": {"dance_set": dance.slot_use}}


def dance_map(new, mode: str) -> dict:
    """#235, #249: this Mac changed the mapping table of the mood or of flowtrack (or asked for the built-in one; the
    dance's is its set's, #265)."""
    dance.set_rows(new, mode)
    return dance.msg()


# ---------- movement (#85): the stage detects it and reports rules ----------
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
