"""Dreamy Eyes (#156): a phone that lends its front camera and looks back with dreaming eyes. Here: the faces the AI
paints for it (#160: fantasy faces from words only), fire (#162) and how often the trance comes (#172). #219: no
portrait of the person is painted – "you in the dream" is drawn on the phone itself (static/dreamyou.js); this part never
takes, keeps or paints from a camera picture."""
import asyncio
import contextlib
import json
import os
import random
import secrets
import time

from fastapi import Request
from fastapi.responses import FileResponse, Response

import config
import hub
import outbox
import render
import rights
import settings
from web import app

# ---------- #160: faces painted by the AI for Dreamy Eyes (goddess, cat, Medusa) – only for the eyes ----------
AIMASK_PROMPTS = {
    "goddess": "ethereal portrait of a beautiful goddess, face in front view, symmetrical, eyes looking at the viewer, "
               "glowing skin, flowing hair, a diadem of light, dark background",
    "cat": "portrait of a mystical cat, face in front view, symmetrical, big eyes looking at the viewer, glowing fur, "
           "dark background",
    "medusa": "portrait of Medusa, face in front view, symmetrical, eyes looking at the viewer, hair of glowing snakes, "
              "dark background",
    # more women of the dream (the owner's wish: at least ten more, all invented)
    "moon": "portrait of a moon priestess, silver hair, a crescent moon diadem, pale glowing skin, starlight",
    "dryad": "portrait of a forest dryad woman, leaves and moss woven in her hair, freckles of pollen, green light",
    "siren": "portrait of a sea siren woman, wet flowing hair with pearls and shells, seafoam, turquoise light",
    "flame": "portrait of a fire dancer woman, hair like flames, embers around her face, warm golden light",
    "frost": "portrait of an ice queen, frost crystals on her skin, a crown of icicles, pale blue light",
    "stars": "portrait of a star weaver woman, constellations glowing on her skin, cosmic dust in her hair",
    "blossom": "portrait of a flower fairy woman, petals in her hair, delicate butterfly wings behind her, soft pink light",
    "oracle": "portrait of a desert oracle woman, a golden veil with tiny coins, kohl-lined eyes, warm sand light",
    "clockwork": "portrait of a clockwork lady, fine brass filigree on her cheeks, tiny gears in her hair, candle light",
    "owl": "portrait of a forest shaman woman, a mask of owl feathers around her eyes, misty night",
    "masquerade": "portrait of a woman with an ornate masquerade mask of gold and lace, candle light, velvet darkness",
    "aurora": "portrait of an aurora spirit woman, hair flowing like northern lights, snow sparkling on her lashes",
    "raven": "portrait of a raven witch woman, black feathers in her hair, dark lips, silver eyes, moonlit fog",
    "nebula": "portrait of a cosmic woman made of a nebula, galaxies in her hair, glowing violet and teal",
    # about a third men (owner's wish): 7 of 24
    "sun": "portrait of a sun god, a man with a golden face, a crown of sun rays, warm glowing light",
    "greenman": "portrait of a green man, a male face made of leaves and vines, moss beard, forest spirit",
    "triton": "portrait of a sea king, a man with a coral crown, wet hair and beard, pearls, deep blue light",
    "sage": "portrait of an old star sage, a man with a long silver beard, constellations on his skin, deep blue robe",
    "faun": "portrait of a faun, a young man with small curled horns, ivy in his hair, mischievous smile",
    "pharaoh": "portrait of a dream pharaoh, a man with a golden mask-like face, lapis lazuli headdress, kohl-lined eyes",
    "knight": "portrait of a moon knight, a man with a noble bare face, no helmet, silver armor, a crescent moon circlet on his brow, pale glowing light",
}
AIMASK_STYLE = ", face in front view, symmetrical, eyes looking at the viewer, dreamlike, dark background"
AIMASK_EVERY = float(os.environ.get("DREAM_AIMASK_EVERY", "50"))   # seconds between two faces
# #218: DREAM_AIMASK=0 – no painted faces at all (the fire spirit included): Dreamy Eyes never make this Mac load a model
AIMASK = os.environ.get("DREAM_AIMASK", "1") != "0"
aimasks: dict = {}          # kind -> (id, JPEG): only in memory, never in the gallery
aimask_state = {"last": 0.0, "i": 0}
eyes_seen: dict = {"fire": 0.0}   # #162: when the eyes last saw fire – a time, never a picture (#219)
# #172: how often the trance (the third eye) may come at most – minutes, 0 = only by hand; kept for the next start
EYES_CFG_FILE = os.path.join(hub.STATE_DIR, "eyes.json")
TRANCE_CHOICES = (0, 5, 12, 25)
eyes_cfg: dict = {"trance_every": 12}
with contextlib.suppress(Exception):
    _te = json.load(open(EYES_CFG_FILE)).get("trance_every")
    if _te in TRANCE_CHOICES:
        eyes_cfg["trance_every"] = _te


async def eyes_send(msg: dict, also_control: bool = False) -> None:
    """A word to every Dreamy Eyes page (and, if asked, to Dream Control and this Mac)."""
    for c, r in list(hub.roles.items()):
        if rights.can(r, "eyes_only") or c in eyes_pages or (also_control and rights.can(r, "control")):
            outbox.post(c, json.dumps(msg))


FIRE_HOLD = 12                                     # #162: seconds a fire seen by the eyes keeps their faces burning
FIRE_STYLE = ", surrounded by flames, glowing embers in the air, firelight on her face"


def eyes_note(msg: dict) -> None:
    """#162: the eyes see fire right now. Nothing about the person in front of them is noted (#219)."""
    if msg.get("fire") is True:
        eyes_seen["fire"] = time.time()


eyes_pages: set = set()     # #166: control sockets of Dreamy Eyes pages, whichever key they signed in with


WORLD_KEYS = ("world", "world_to", "world_mix")   # #224: the world, the one it fades to, and how far on the way


def world_msg() -> dict:
    """#221, #224: the style world to draw in, the one it fades to and how far – all Dreamy Eyes and the dream windows
    are told of the settings (they never set them)."""
    return {k: hub.state[k] for k in WORLD_KEYS}


def world_tell() -> None:
    """The style world or its crossfade changed: every Dreamy Eyes page and every dream window hears it (once, also
    when several of the three changed in one step: hub.apply)."""
    text = json.dumps(world_msg())
    for c in world_watchers():
        outbox.post(c, text)


def world_watchers() -> list:
    return [c for c, r in hub.roles.items() if rights.can(r, "eyes_only") or c in eyes_pages] + list(hub.windows)


for _k in WORLD_KEYS:
    hub.on_change(_k, world_tell)

# ---------- #224: the drift – Dream wanders from style world to style world by itself ----------
# One world every `world_auto` seconds: it stays for a while, then the mix glides over to the next world in the list.
# The server steps the mix (the pages follow it softly), so every eye and window shows the same and the sliders of the
# panel and of Dream Control show where it is. A hand on the world, the target or the mix (panel, Dream Control, MIDI)
# is noticed – one of the three settings was set by someone else than the drift (also to what it already was: a tap
# on the world that shows), or they are no longer what the drift left – and makes the drift wait WORLD_HAND seconds,
# then it goes on from wherever the hand left the mix. What the panel and Dream Control show of it – how long it still
# waits, when the next world begins to come – they are told whenever it changes (`drift_msg`) and count down themselves.
WORLD_STEP = 0.25                                  # seconds between two steps of the mix
WORLD_STAY = 0.4                                   # the share of its time a world is shown alone
WORLD_HAND = 180.0                                 # seconds the drift waits after a hand on the worlds
drift: dict = {"left": None, "stay_from": None, "wait_until": 0.0, "at": None, "hand": False, "own": False, "told": None}


def _world_hand() -> None:
    if not drift["own"]:                           # (not the drift's own step)
        drift["hand"] = True


for _k in WORLD_KEYS:
    hub.on_change(_k, _world_hand)


def drift_msg(now: float) -> dict:
    """What the panel and Dream Control show of the drift at the time `now` (seconds, monotonic): the seconds it still
    waits after a hand, the seconds until the next world begins to come (None: it is off, waits or is on its way),
    and whether it rests because nobody looks."""
    every, stay = hub.state["world_auto"], drift["stay_from"]
    wait = max(0.0, drift["wait_until"] - now) if every else 0.0
    ahead = max(0.0, every * WORLD_STAY - (now - stay)) if every and not wait and stay is not None else None
    return {"world_drift": {"wait": round(wait), "next": None if ahead is None else round(ahead),
                            "idle": bool(every) and not world_watchers()}}


async def world_step(now: float) -> None:
    """One step of the drift at the time `now` (seconds, monotonic) – and a word to the pages when its state changed."""
    await _drift_step(now)
    every = hub.state["world_auto"]
    state = (every, drift["wait_until"] if every and now < drift["wait_until"] else 0.0, drift["stay_from"], bool(world_watchers()))
    if state != drift["told"]:
        drift["told"] = state
        await hub.broadcast(drift_msg(now))


async def _drift_step(now: float) -> None:
    s, every = hub.state, hub.state["world_auto"]
    cur = tuple(s[k] for k in WORLD_KEYS)
    dt, drift["at"] = (min(1.0, now - drift["at"]) if drift["at"] is not None else 0.0), now   # (a stalled loop is no leap)
    if drift["hand"] or (drift["left"] is not None and cur != drift["left"]):   # a hand was on it
        drift["wait_until"], drift["hand"] = now + WORLD_HAND, False
    drift["left"] = cur
    if not every or len(settings.WORLDS) < 2 or now < drift["wait_until"] or not world_watchers():
        drift["stay_from"] = None                  # nobody looks, it is off or it waits: time does not count
        return
    a, b, k = cur
    if a == b or k <= 0:                           # one world: it stays, then the next one begins to come
        if drift["stay_from"] is None:
            drift["stay_from"] = now
        if now - drift["stay_from"] < every * WORLD_STAY:
            return
        change = {"world_to": b if b != a else settings.world_next(a), "world_mix": 0.001}
    else:
        k = min(1.0, k + dt / (every * (1 - WORLD_STAY)))
        # there: the target is the world now, and the one after it the next target (the picture stays what it is)
        change = {"world": b, "world_to": settings.world_next(b), "world_mix": 0.0} if k >= 1 else {"world_mix": round(k, 4)}
    drift["stay_from"] = None
    drift["own"] = True
    try:
        await hub.apply(change, persist=False, by="drift")
    finally:
        drift["own"] = False
    drift["left"] = tuple(s[k] for k in WORLD_KEYS)


hub.on_change("world_auto", lambda: drift.update(wait_until=0.0, hand=False))   # the drift chosen anew: it does not wait


async def world_loop():
    while True:
        await asyncio.sleep(WORLD_STEP)
        await world_step(time.monotonic())


def aimask_msg() -> dict:
    return {"aimasks": {k: f"/eyes/mask/{v[0]}.jpg" for k, v in aimasks.items()}}


async def aimask_loop():
    """While Dreamy Eyes look on and this Mac paints, a face now and then – one quick step, in the dream's mood."""
    if not AIMASK:
        return
    while True:
        await asyncio.sleep(5)
        await aimask_step()


async def aimask_step() -> None:
    """One look at whether a face is due, and its painting: from words only (`AIMASK_PROMPTS`, the dream's mood) –
    #219: never from a picture."""
    loop = asyncio.get_running_loop()
    eyes = [c for c, r in hub.roles.items() if rights.can(r, "eyes_only") or c in eyes_pages] + list(hub.windows)   # #166, #201: the windows too
    now = time.time()
    if (not eyes or hub.state["backend"] != "local" or not hub.state.get("running", True) or render.model_state.get("loading")):
        return
    mood = str(hub.state.get("prompt") or "")[:160]
    fire = now - eyes_seen.get("fire", 0) < FIRE_HOLD   # #162: the eyes see fire – their faces burn too
    flame_due = fire and now - aimasks.get("flame", (None, None, 0))[2] > 60
    if now - aimask_state["last"] < (min(5, AIMASK_EVERY) if flame_due else AIMASK_EVERY):
        return
    if not aimask_state.get("order"):         # every face once per round, in a new order each round
        aimask_state["order"] = random.sample(list(AIMASK_PROMPTS), len(AIMASK_PROMPTS))
    if flame_due:
        kind = "flame"                         # the fire spirit first, freshly painted
        with contextlib.suppress(ValueError):
            aimask_state["order"].remove("flame")
    else:
        kind = aimask_state["order"].pop()
    base = AIMASK_PROMPTS[kind]
    prompt = (base + ("" if "front view" in base else AIMASK_STYLE) + (FIRE_STYLE if fire else "")
              + (f", in the mood of: {mood}" if mood else ""))
    aimask_state["last"] = time.time()
    try:
        pic = await loop.run_in_executor(None, lambda: render.make_picture(
            render.model_state.get("active") or "sd-turbo", prompt, 512, 512, secrets.randbelow(2**31), refine=False, steps=1))
    except Exception as e:                     # never disturb the show for a mask
        print("dreamy eyes mask:", e, flush=True)
        return
    aimask_state["i"] += 1
    aimasks[kind] = (secrets.token_hex(6), render._jpeg(pic), time.time())
    print(f"dreamy eyes: a {kind} face in {time.time() - aimask_state['last']:.2f} s", flush=True)
    for c in eyes:
        outbox.post(c, json.dumps(aimask_msg()))


@app.get("/eyes/mask/{name}")
def eyes_mask(request: Request, name: str):
    if not rights.can(request.state.role, "faces"):   # #201: the windows show the faces too
        return Response(status_code=403)
    for mid, data, _ in aimasks.values():
        if name == f"{mid}.jpg":
            return Response(data, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})
    return Response(status_code=404)


@app.get("/eyes")
def eyes_page():
    """#156: Dreamy Eyes – a phone that lends its front camera and looks back with dreaming eyes."""
    return FileResponse(os.path.join(config.HERE, "static", "eyes.html"), headers={"Cache-Control": "no-cache"})
