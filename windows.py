"""Dream windows (#201): any number of old phones and tablets as windows to the dream."""
import asyncio
import json
import os
import random
import time

from fastapi.responses import FileResponse

import config
import eyes
import hub
import outbox
from web import app

# One organism over all of them: no window has a motif. Dream only sows seeds – which living thing, where it comes
# in and goes out, a random number – and every window draws it itself (static/window.html, static/dreamlife.js).
# Wanderers go from window to window: when one leaves a window, it comes into the next one from the other side.
# They all hear the stage's pulse (the /view stream), now and then a wave runs over them in the order they came,
# and they feel with Dreamy Eyes (trance, blushing).
WANDER_KINDS = ("cloud", "cloud", "moth", "eye", "symbol", "bubbles", "aurora", "picture", "orbit")
LOCAL_KINDS = ("mandala", "bloom", "tree", "kaleido", "eyes", "symbol", "picture", "cloud", "face")
SYMBOLS = ("spiral", "flower", "star", "moon", "third", "sun")
EDGES = ("left", "right", "top", "bottom")
OPPOSITE = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}
WINDOW_MOODS = ("trance", "blush")
wanderers: list = []                               # [when, seed, hops left, index of the window it leaves]
seed_no = [0]
mood_at: dict = {}


def window_seed(kind: str, wander: bool, enter: str = "in") -> dict:
    seed_no[0] += 1
    if kind == "face" and not eyes.aimasks:             # no face painted yet: something else
        kind = "mandala"
    exit_ = random.choice([e for e in EDGES if e != enter]) if wander else "in"
    return {"id": seed_no[0], "kind": kind, "variant": random.choice(SYMBOLS) if kind == "symbol" else "",
            "seed": random.randrange(1 << 30), "life": round(random.uniform(7, 12) if wander else random.uniform(9, 16), 2),
            "enter": enter, "exit": exit_, "hue": round(random.uniform(-70, 70)), "size": round(random.uniform(0.7, 1.3), 2)}


async def window_send(sock, msg: dict):
    outbox.post(sock, json.dumps(msg))


def window_add(sock):
    hub.windows[sock] = {"next": time.time() + random.uniform(0.3, 1.5)}


async def window_tell_all():
    for i, c in enumerate(list(hub.windows)):
        await window_send(c, {"window": {"index": i, "of": len(hub.windows)}})


async def windows_mood(kind: str):
    """Dreamy Eyes go into trance or blush: all windows feel it – the blush runs through them in their order."""
    now = time.time()
    if now - mood_at.get(kind, 0) < 3 or not hub.windows:
        return
    mood_at[kind] = now
    for i, c in enumerate(list(hub.windows)):
        await window_send(c, {"mood": {"kind": kind, "index": i, "of": len(hub.windows)}})


async def windows_tick(now: float):
    order = list(hub.windows)
    for c in order:
        w = hub.windows[c]
        if now > w["next"]:                        # a new seed for this window: something blooming here or a wanderer
            w["next"] = now + random.uniform(2.0, 4.5)
            wander = random.random() < 0.45
            seed = window_seed(random.choice(WANDER_KINDS if wander else LOCAL_KINDS), wander,
                               random.choice(EDGES) if wander else "in")
            await window_send(c, {"life": seed})
            if wander:
                wanderers.append([now + seed["life"], seed, random.randint(1, 3), order.index(c)])
    for wd in list(wanderers):                     # wanderers leave one window and come into the next one
        if now < wd[0]:
            continue
        wanderers.remove(wd)
        if not order:
            continue
        last, hops = wd[1], wd[2]
        target = order[(wd[3] + 1) % len(order)]
        seed = window_seed(last["kind"], True, OPPOSITE[last["exit"]])
        seed.update(variant=last["variant"], seed=last["seed"], hue=last["hue"], size=last["size"])   # the same being
        await window_send(target, {"life": seed})
        if hops > 1:
            wanderers.append([now + seed["life"], seed, hops - 1, order.index(target)])


async def windows_loop():
    next_wave = time.time() + random.uniform(40, 90)
    while True:
        await asyncio.sleep(0.5)
        if not hub.windows:
            wanderers.clear()
            continue
        now = time.time()
        await windows_tick(now)
        if now > next_wave and len(hub.windows) > 1:   # a wave over all of them, in the order they came
            next_wave = now + random.uniform(60, 150)
            for i, c in enumerate(list(hub.windows)):
                await window_send(c, {"wave": {"index": i, "of": len(hub.windows)}})


@app.get("/window")
def window_page():
    """#201: a dream window – an old phone or tablet that shows an aspect of the dream."""
    return FileResponse(os.path.join(config.HERE, "static", "window.html"), headers={"Cache-Control": "no-cache"})
