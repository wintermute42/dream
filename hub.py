"""The hub: the shared control state and everybody who is connected. The stage (index.html) renders; remotes
(remote.html) only change settings. Every change goes through `apply` and from there to all other clients
(`broadcast`). The state survives restarts (state.json), so an installation comes back exactly as it was."""
import asyncio
import json
import os
import time

import dance
import movement
import outbox
import playlists
import rights
import settings

STATE_DIR = rights.STATE_DIR                               # #186: DREAM_STATE_DIR, default ~/.local/state/dream
STATE_FILE = os.path.join(STATE_DIR, "state.json")

try:
    with open(STATE_FILE) as f:
        saved = json.load(f)
    state = settings.loaded(saved)
    dance.adopt(saved)                             # #249: the switches of the old movement cards → rows, once
except (FileNotFoundError, ValueError):
    state = dict(settings.DEFAULT_STATE)
# #133: values saved by earlier, German versions in today's English
state["playlist"] = playlists.new_name(str(state["playlist"]))
state["music_pattern"] = playlists.OLD_PATTERNS.get(state["music_pattern"], state["music_pattern"])
state["style"] = playlists.OLD_STYLES.get(state["style"], state["style"])
# the movement mode is remembered like every other setting (#90, #249)
state["backend"] = "local"        # #102: every start computes on this Mac; the cloud (it costs) only when chosen
state["clutch"] = False           # #251: every start has the dance's clutch released – it is engaged only on purpose
if state.get("cam_device") == "device":          # #146: a device's live camera never outlives the run it was sent in
    state["cam_device"] = ""
    if state.get("mode") == "cam":
        state["mode"] = "dream"
live = {"fps": 0.0, "stages": 0, "remotes": 0, "scene_at": time.time(), "index": -1}
clients: dict = {}          # WebSocket -> "stage" | "remote"
roles: dict = {}            # #148: control socket -> what it may do now: "local" | "control" | "guest"
key_roles: dict = {}        # #148: socket (control, output, preview) -> the role its key gives
viewers: set = set()        # output windows (/output): they only show what the stage shows
beats: set = set()          # #218: Dreamy Eyes pages that hear the beat beside their preview (rights: "beat")
previews: dict = {}         # #141: small live previews on remotes and Dreamy Eyes – socket → "small" | "full" (#187)
windows: dict = {}          # #201: dream windows (what each one shows: windows.motifs); in the order they came
midi_ports: list = []       # the MIDI controllers plugged in right now, by name
# what else happens when a setting changes: setting -> functions, registered by the module that acts on it
# (the Syphon output on "syphon", the cloud watcher on "backend")
watchers: dict = {}


def on_change(key: str, react) -> None:
    watchers.setdefault(key, []).append(react)


def save_state():
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, allow_nan=False)   # #175: never NaN on disk
    os.replace(tmp, STATE_FILE)


# #187: a slider that is dragged changes the state about 15 times a second. The file is written once the hands
# rest (SAVE_AFTER seconds after the last change), during a long drag at least every SAVE_LATEST seconds, and when
# Dream is stopped.
SAVE_AFTER, SAVE_LATEST = 1.0, 5.0
saving: dict = {"timer": None, "since": 0.0}


def save_soon():
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:                         # no event loop (a script, a test): write right away
        save_state()
        return
    now = time.monotonic()
    if saving["timer"] is None:
        saving["since"] = now
    else:
        saving["timer"].cancel()
    wait = max(0.0, min(SAVE_AFTER, saving["since"] + SAVE_LATEST - now))
    saving["timer"] = loop.call_later(wait, save_now)


def save_now():
    """Writes what save_soon put off (also when Dream stops)."""
    timer, saving["timer"] = saving["timer"], None
    if timer is None:
        return
    timer.cancel()
    try:
        save_state()
    except (OSError, ValueError) as e:           # a full disk must not end the show; the next change tries again
        print("state not saved:", repr(e)[:200], flush=True)


async def broadcast(msg: dict, exclude=None, only=None):
    """To every control client. #187: only queued (outbox.py) – a slow device never holds up the others."""
    data = json.dumps(msg, ensure_ascii=False)
    for c, kind in list(clients.items()):
        if c is exclude or (only and kind != only) or rights.can(roles.get(c), "eyes_only"):   # #156: the eyes learn nothing
            continue
        if not outbox.post(c, data):
            clients.pop(c, None)


def status_msg() -> dict:
    live["stages"] = sum(1 for k in clients.values() if k == "stage")
    live["remotes"] = sum(1 for k in clients.values() if k == "remote")
    flow = round(live.get("flow_rate", 0)) if movement.camera_on(state) else 0
    return {"live": {**{k: live[k] for k in ("fps", "stages", "remotes")}, "flowtrack": flow,
                     "viewers": len(viewers), "previews": len(previews), "windows": len(windows), "beats": len(beats),
                     "midi": midi_ports}}


async def apply(changes: dict, exclude=None, persist=True, by=None):
    """by: who changed it by hand ("remote", "stage", "midi") – the autopilot leaves such settings alone a while."""
    if by != "glide":                              # #216: whatever else sets a value takes it out of a running glide
        gliding["keys"] -= changes.keys()
    clean = {}
    for k, v in changes.items():
        if k in settings.DEFAULT_STATE:
            try:
                clean[k] = settings.coerce(k, v)
            except (ValueError, TypeError, OverflowError):   # #175: anything odd is simply not taken
                pass
    if not clean:
        return
    if "playlist" in clean:
        live["index"] = -1
        live["scene_at"] = 0          # start the new playlist right away
    state.update(clean)
    if persist:
        save_soon()
    for react in dict.fromkeys(r for k in clean for r in watchers.get(k, ())):   # each once, whatever changed together
        react()
    if "master" in clean:                          # output windows dim with the stage
        for v in list(viewers):
            if not outbox.post(v, json.dumps({"master": state["master"]})):
                viewers.discard(v)
    await broadcast({"set": clean, **({"by": by} if by else {})}, exclude=exclude)
    # #247: whoever asked for a value a stepped setting does not have hears what it became (the others hear it anyway)
    snapped = {k: v for k, v in clean.items() if settings.SETTINGS[k].steps and v != changes[k]}
    if snapped and exclude in clients and not rights.can(roles.get(exclude), "eyes_only"):
        outbox.post(exclude, json.dumps({"set": snapped}))


# ---------- #216: reset – the picture's settings glide home, and back again for a few seconds ----------
# The server steps the values (about twelve a second, eased): every page shows its sliders gliding, the stage gets them
# like a hand on a slider – nothing more for the AI to do – and it works from Dream Control without a detour.
GLIDE_SECS, GLIDE_STEP, UNDO_SECS = 4.0, 1 / 12, 10.0
gliding: dict = {"task": None, "keys": set()}     # the settings on their way right now
undo: dict = {"values": None, "until": 0.0}        # what the last reset changed, and until when it can be taken back


async def glide_to(goal: dict) -> None:
    """The numbers that shape the picture (those with a weight) glide to their goal in GLIDE_SECS; everything else is
    set at once, in one step: switches, choices, and the style with its strengths, so the model is rebuilt at most once
    (the stage fades effects itself)."""
    if gliding["task"]:
        gliding["task"].cancel()
    start = {k: state[k] for k, v in goal.items() if settings.SETTINGS[k].weight and state[k] != v}
    await apply({k: v for k, v in goal.items() if not settings.SETTINGS[k].weight and state[k] != v}, by="reset")
    gliding["keys"] = set(start)
    gliding["task"] = asyncio.create_task(_glide(start, goal)) if start else None


async def _glide(start: dict, goal: dict) -> None:
    t0, keys = time.monotonic(), gliding["keys"]
    while keys:
        await asyncio.sleep(GLIDE_STEP)
        p = min(1.0, (time.monotonic() - t0) / GLIDE_SECS)
        e = p * p * (3 - 2 * p)                      # leaves and arrives softly
        # the last step is the goal itself, exactly; only that one is written to the file
        await apply({k: goal[k] if p >= 1 else start[k] + (goal[k] - start[k]) * e for k in list(keys)},
                    persist=p >= 1, by="glide")
        if p >= 1:
            break
    if gliding["keys"] is keys:                    # not replaced by a newer glide meanwhile
        keys.clear()
        gliding["task"] = None


async def reset() -> None:
    """Everything in settings.RESET goes to its default; what it changed can be taken back for UNDO_SECS."""
    before = {k: state[k] for k, v in settings.RESET.items() if state[k] != v}
    undo.update(values=before or None, until=time.monotonic() + UNDO_SECS)
    await glide_to(dict(settings.RESET))
    await broadcast({"reset": {"undo": UNDO_SECS if before else 0}})


async def reset_undo() -> None:
    """Back to exactly what was before the reset – as softly as it went."""
    values, undo["values"] = undo["values"], None
    if not values or time.monotonic() > undo["until"]:
        return
    await glide_to(values)
    await broadcast({"reset": {"undo": 0, "undone": True}})
