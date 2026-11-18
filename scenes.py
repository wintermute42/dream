"""Playlists and scenes: the next scene of the running playlist, and reading, editing, deleting and generating
playlists (the owner's file ~/.config/dream/playlists.json)."""
import asyncio
import os
import re
import secrets
import time

from fastapi import Body
from fastapi.responses import JSONResponse

import config
import hub
import playlists
import settings
from web import app

temp_lists: dict = {}       # AI playlists of this run: only in memory, gone after a restart


def load_playlists() -> dict:
    return playlists.load(config.HERE, temp_lists)


def playlist_names() -> list:
    return playlists.names(config.HERE, temp_lists)


async def next_scene(force=False):
    lists = load_playlists()
    name = hub.state["playlist"]
    if name == playlists.SURPRISE:
        scenes, journey, fade = [], False, playlists.DEFAULT_FADE
    else:
        scenes, journey, fade = playlists.playlist(lists.get(name))
        if not scenes:
            return
    wait = hub.live.get("scene_secs") or max(5, int(hub.state["interval"]))
    if not force and time.time() - hub.live["scene_at"] < wait:
        return
    if name == playlists.SURPRISE:              # a random scene from any playlist, with random style additions
        sc = playlists.surprise(lists)
        if not sc:
            return
        hub.live["index"], count = hub.live["index"] + 1, 0
    else:
        if hub.state["shuffle"] and not journey and len(scenes) > 1:
            choices = [i for i in range(len(scenes)) if i != hub.live["index"]]
            hub.live["index"] = choices[secrets.randbelow(len(choices))]
        else:
            hub.live["index"] = (hub.live["index"] + 1) % len(scenes)
        sc, count = scenes[hub.live["index"]], len(scenes)
    hub.live["scene_at"], hub.live["scene_secs"] = time.time(), sc["secs"]
    before = hub.state["prompt"]
    # the scene's own settings come along (they stay until something else changes them)
    await hub.apply({"prompt": sc["prompt"], **{k: v for k, v in sc["settings"].items() if k in settings.DEFAULT_STATE}})
    await hub.broadcast({"scene": {"playlist": name, "index": hub.live["index"], "count": count, "journey": journey,
                               "pattern": sc["pattern"], "from": before, "fade": fade}})


async def scene_loop():
    while True:
        await asyncio.sleep(1)
        try:
            if hub.state["playlist"]:
                await next_scene()
        except Exception as e:                    # never let the installation loop die
            print("scene loop:", e, flush=True)


# ---------- playlists: read, edit, delete, generate (the owner's file ~/.config/dream/playlists.json) ----------
@app.get("/playlists/{name}")
def playlist_get(name: str):
    lists = load_playlists()
    if name not in lists:
        return JSONResponse({"error": "unknown"}, status_code=404)
    builtin = name in playlists.read_file(os.path.join(config.HERE, "playlists.json"))
    return {"name": name, "text": playlists.to_text(lists[name]), "builtin": builtin,
            "own": name in playlists.read_file(playlists.USER_FILE), "temp": name in temp_lists}


@app.post("/playlists")
async def playlist_save(data: dict = Body(...)):
    name = playlists.clean_name(data.get("name", ""))
    entry = playlists.from_text(data.get("text", ""))
    scenes = entry["scenes"] if isinstance(entry, dict) else entry
    if not name or not scenes:
        return JSONResponse({"error": "empty"}, status_code=422)
    playlists.save_user(name, entry)               # saving keeps it: also a temporary AI playlist becomes own
    temp_lists.pop(name, None)
    await hub.broadcast({"playlists": playlist_names()})
    return {"name": name, "count": len(scenes)}


@app.delete("/playlists/{name}")
async def playlist_delete(name: str):
    """Removes the owner's own version; a shipped playlist of the same name comes back."""
    if name in temp_lists:
        temp_lists.pop(name)
    else:
        playlists.save_user(name, None)
    if hub.state["playlist"] == name and name not in load_playlists():
        await hub.apply({"playlist": ""})
    await hub.broadcast({"playlists": playlist_names()})
    return {"deleted": name}


@app.post("/playlists/generate")
async def playlist_generate(data: dict = Body(...)):
    topic = re.sub(r"\s+", " ", str(data.get("topic", ""))).strip()[:120]
    if not topic:
        return JSONResponse({"error": "empty"}, status_code=422)
    try:
        prompts = await asyncio.get_running_loop().run_in_executor(
            None, playlists.generate, topic, config.OLLAMA, config.PROMPT_MODEL)
    except (OSError, ValueError):                  # Ollama not running, model missing or a broken answer
        return JSONResponse({"error": "ollama"}, status_code=503)
    if len(prompts) < 3:
        return JSONResponse({"error": "few"}, status_code=502)
    name = playlists.clean_name(playlists.AI_PREFIX + topic)
    playlists.keep_temp(temp_lists, name, prompts)  # temporary; "Keep"/"Save" makes it the owner's own
    await hub.broadcast({"playlists": playlist_names()})
    return {"name": name, "prompts": prompts, "temp": True}
