"""Dream windows (#201, #214): any number of old phones and tablets as windows to the dream."""
import asyncio
import json
import os
import random
import re
import time

from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

import config
import eyes
import hub
import outbox
import rights
from web import app

# #214: every window shows one large, living motif, and around it the dream as drifting clouds. Dream only says which
# motif a window shows and when it wanders on; every window draws it itself (static/window.html with dreamlife.js,
# dreameye.js and dreamface.js). Now and then a motif dissolves into clouds in one window and forms again in another;
# no two windows show the same one at a time – except the pair of eyes, which looks out of two windows together.
# Small beings of light drift from window to window (#201), they all hear the stage's pulse (the /view stream), now and
# then a wave runs over them in the order they came, and they feel with Dreamy Eyes (trance, blushing).
MOTIFS = ("eye", "face", "penrose", "stairs", "fork", "cube", "third", "mandala")
PAIR = "pair"                                      # one eye each in two windows
PAIR_CHANCE = 0.25                                 # how often, instead of a wandering, a pair of eyes opens
WANDER_MIN = float(os.environ.get("DREAM_WANDER_EVERY", "60"))   # seconds between two wanderings: this to three times this
DISSOLVE = 4.0                                     # seconds a motif takes to dissolve into clouds, or to form out of them
LIFE_KINDS = ("cloud", "moth", "bubbles", "aurora")
EDGES = ("left", "right", "top", "bottom")
OPPOSITE = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}
WINDOW_MOODS = ("trance", "blush")
motifs: dict = {}                                  # window -> {"kind", "seed"} with "face" (its picture) or "half" (of the pair)
wanderers: list = []                               # [when, seed, hops left, index of the window it leaves]
seed_no = [0]
mood_at: dict = {}
clock = {"wander": 0.0, "life": 0.0, "wave": 0.0}

# #214: the painted faces come alive in the windows. Where a face has its eyes, brows, mouth and outline is found once
# per painted face, by the stage on this Mac (static/dreamface.js, with the face model Dream has anyway) – never by a
# window, and not again for another window. Dream keeps the points with the face and hands them on: a few hundred bytes.
# #230: Dreamy Eyes move the painted face in their pupils the same way – the points go to them too (`lookers`), and
# nothing else of the windows does.
FACE_POINTS = 82                                   # the points of a face – as many as DreamFace.PICK names (a test compares)
MARKS_TRIES = 2
marks: dict = {}                                   # face id -> [x0, y0, x1, y1, …] in thousandths of the picture; None: no face found
asked: dict = {}                                   # face id -> (when asked last, how often)
markers: list = []                                 # the stage pages that find the points


def window_seed(kind: str, enter: str) -> dict:
    """A small being that drifts through a window: what, where it comes in and goes out, a random number."""
    seed_no[0] += 1
    return {"id": seed_no[0], "kind": kind, "seed": random.randrange(1 << 30), "life": round(random.uniform(7, 12), 2),
            "enter": enter, "exit": random.choice([e for e in EDGES if e != enter]), "hue": round(random.uniform(-70, 70)),
            "size": round(random.uniform(0.7, 1.3), 2)}


def face_urls() -> list:
    return list(eyes.aimask_msg()["aimasks"].values())


def motif_pick(taken: list) -> str:
    """A motif no window shows right now; with more windows than motifs, one of those shown least."""
    kinds = [k for k in MOTIFS if k != "face" or eyes.aimasks]   # no face painted yet: no face to show
    least = min(taken.count(k) for k in kinds)
    return random.choice([k for k in kinds if taken.count(k) == least])


def motif_make(kind: str, half: int | None = None, seed: int | None = None) -> dict:
    m = {"kind": kind, "seed": random.randrange(1 << 30) if seed is None else seed}
    if kind == "face":
        m["face"] = random.choice(face_urls())
    if half is not None:
        m["half"] = half
    return m


def motif_send(sock, wait: float = 0.0) -> None:
    """What this window shows from now on: its old motif dissolves, the new one forms after `wait` seconds. With
    Dream's clock, so that windows breathe, look and blink together whatever their own clocks say."""
    outbox.post(sock, json.dumps({"motif": {**motifs[sock], "wait": round(wait, 1), "now": int(time.time() * 1000)}}))


def motifs_set(plan: dict) -> None:
    for c, (m, wait) in plan.items():
        motifs[c] = m
        motif_send(c, wait)


def _taken(plan: dict) -> list:
    return [m["kind"] for c, m in motifs.items() if c not in plan] + [m["kind"] for m, _ in plan.values()]


def _fresh(plan: dict, sock, wait: float) -> None:
    plan[sock] = (motif_make(motif_pick(_taken(plan))), wait)


def wander() -> dict:
    """#214: one motif dissolves into clouds and forms again in another window. Returns who shows what from now on:
    window -> (motif, seconds until it forms)."""
    order = [c for c in hub.windows if c in motifs]
    if not order:
        return {}
    plan: dict = {}
    src = random.choice(order)
    pair = [c for c in order if motifs[c]["kind"] == PAIR]
    others = [c for c in order if c is not src]
    if src in pair:                                # the pair of eyes moves on together – or closes, where there is no room
        room = [c for c in order if c not in pair]
        if len(room) >= 2:                         # two windows next to each other, where there are such
            near = [i for i in range(len(room) - 1) if order.index(room[i + 1]) == order.index(room[i]) + 1]
            i = random.choice(near) if near else random.randrange(len(room) - 1)
            for half, c in enumerate(room[i:i + 2]):
                plan[c] = (motif_make(PAIR, half, motifs[src]["seed"]), DISSOLVE)
        for c in pair:
            _fresh(plan, c, 2 * DISSOLVE if len(room) >= 2 else DISSOLVE)
    elif not others:                               # a single window: its motif dissolves, another one forms
        _fresh(plan, src, DISSOLVE)
    elif not pair and random.random() < PAIR_CHANCE:   # a pair of eyes opens in this window and the one next to it
        i = order.index(src)
        two = (src, order[i + 1]) if i + 1 < len(order) else (order[i - 1], src)
        seed = random.randrange(1 << 30)
        for half, c in enumerate(two):
            plan[c] = (motif_make(PAIR, half, seed), DISSOLVE)
    else:                                          # the motif wanders: gone here, there a few seconds later
        dst = random.choice(others)
        moving = dict(motifs[src])
        if moving["kind"] == "face" and moving["face"] not in face_urls():   # its picture is gone: a face of now
            moving = motif_make("face" if eyes.aimasks else "mandala", seed=moving["seed"])
        plan[dst] = (moving, DISSOLVE)
        if dst in pair:                            # half a pair is no pair
            _fresh(plan, next(c for c in pair if c is not dst), DISSOLVE)
        _fresh(plan, src, 2 * DISSOLVE)
    return plan


def marks_msg(only: str | None = None) -> dict:
    return {"marks": {k: v for k, v in marks.items() if v and (only is None or k == only)}}


def window_add(sock) -> None:
    hub.windows[sock] = {}
    motifs[sock] = motif_make(motif_pick(_taken({})))


def lookers() -> list:
    """Who shows the painted faces and moves them: the dream windows and the Dreamy Eyes pages (#230)."""
    return list(hub.windows) + eyes.eyes_socks()


def marks_greet(sock) -> None:
    """The points of the painted faces for a window or a Dreamy Eyes page that just came (after the faces themselves)."""
    if any(marks.values()):
        outbox.post(sock, json.dumps(marks_msg()))


def window_greet(sock) -> None:
    """What a window that just came needs: the painted faces, their points, its motif."""
    outbox.post(sock, json.dumps(eyes.aimask_msg()))
    marks_greet(sock)
    motif_send(sock)


async def window_remove(sock) -> None:
    hub.windows.pop(sock, None)
    gone = motifs.pop(sock, None)
    if gone and gone["kind"] == PAIR:              # the other eye of the pair stays alone: something else forms there
        plan: dict = {}
        for c in [c for c, m in motifs.items() if m["kind"] == PAIR]:
            _fresh(plan, c, DISSOLVE)
        motifs_set(plan)
    await window_tell_all()


async def window_send(sock, msg: dict):
    outbox.post(sock, json.dumps(msg))


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


def marks_tick(now: float) -> None:
    """Asks the stage for the points of every painted face that has none yet – once per face, however many windows
    and Dreamy Eyes look on (#230)."""
    ids = {v[0] for v in eyes.aimasks.values()}
    for old in [k for k in list(marks) + list(asked) if k not in ids]:
        marks.pop(old, None)
        asked.pop(old, None)
    if not markers or not lookers():
        return
    for face in ids:
        when, tries = asked.get(face, (0.0, 0))
        if face in marks or now - when < 20:
            continue
        if tries >= MARKS_TRIES:                   # the stage does not answer for this one: it stays still
            marks[face] = None
            continue
        asked[face] = (now, tries + 1)
        outbox.post(markers[0], json.dumps({"face": face, "url": f"/eyes/mask/{face}.jpg"}))


def marks_take(msg) -> str | None:
    """The stage's answer for one face: its points, or none found. Returns the face's id if it has points now."""
    face = msg.get("face") if isinstance(msg, dict) else None
    if not isinstance(face, str) or not re.fullmatch(r"[0-9a-f]{12}", face) or face not in {v[0] for v in eyes.aimasks.values()}:
        return None
    pts = msg.get("points")
    if (isinstance(pts, list) and len(pts) == 2 * FACE_POINTS
            and all(type(v) is int and 0 <= v <= 1000 for v in pts)):
        marks[face] = pts
        return face
    marks[face] = None                             # no face found in it (a cat, a mask): it is shown still
    return None


async def windows_tick(now: float):
    order = list(hub.windows)
    if order and now > clock["life"]:              # a small being of light sets out through the windows
        clock["life"] = now + random.uniform(6, 14)
        i = random.randrange(len(order))
        seed = window_seed(random.choice(LIFE_KINDS), random.choice(EDGES))
        await window_send(order[i], {"life": seed})
        wanderers.append([now + seed["life"], seed, random.randint(1, 3), i])
    for wd in list(wanderers):                     # it leaves one window and comes into the next one
        if now < wd[0]:
            continue
        wanderers.remove(wd)
        if not order:
            continue
        last, hops = wd[1], wd[2]
        target = order[(wd[3] + 1) % len(order)]
        seed = window_seed(last["kind"], OPPOSITE[last["exit"]])
        seed.update(seed=last["seed"], hue=last["hue"], size=last["size"])   # the same being
        await window_send(target, {"life": seed})
        if hops > 1:
            wanderers.append([now + seed["life"], seed, hops - 1, order.index(target)])
    if order and now > clock["wander"]:            # #214: a motif wanders on
        if clock["wander"]:
            motifs_set(wander())
        clock["wander"] = now + random.uniform(WANDER_MIN, 3 * WANDER_MIN)
    if now > clock["wave"] and len(order) > 1:     # a wave over all of them, in the order they came
        if clock["wave"]:
            for i, c in enumerate(order):
                await window_send(c, {"wave": {"index": i, "of": len(order)}})
        clock["wave"] = now + random.uniform(60, 150)
    marks_tick(now)


async def windows_loop():
    while True:
        await asyncio.sleep(0.5)
        if not hub.windows:
            wanderers.clear()
            clock.update(wander=0.0, wave=0.0)
            marks_tick(time.time())                # #230: Dreamy Eyes alone want the points of their faces too
            continue
        await windows_tick(time.time())


@app.websocket("/facemarks")
async def facemarks(sock: WebSocket):
    """#214: the stage on this Mac finds the points of the painted faces (asked here, answered here)."""
    if not rights.ws_can(sock, "stage"):
        await sock.close(code=4403)
        return
    await sock.accept()
    outbox.box(sock)
    markers.append(sock)
    try:
        while True:
            text = await sock.receive_text()
            if len(text) > 4000:
                continue
            try:
                face = marks_take(json.loads(text))
            except ValueError:
                continue
            if face:
                for c in lookers():
                    outbox.post(c, json.dumps(marks_msg(face)))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        markers.remove(sock)
        outbox.drop(sock)


@app.get("/window")
def window_page():
    """#201: a dream window – an old phone or tablet that shows an aspect of the dream."""
    return FileResponse(os.path.join(config.HERE, "static", "window.html"), headers={"Cache-Control": "no-cache"})
