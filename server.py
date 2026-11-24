"""Dream – a live AI dream machine. The entry point (`uvicorn server:app`), two roles (environment variable DREAM_ROLE):

- "app" (default, on the Mac): serves the pages (static/), transcribes voice locally (Whisper on MLX), rewrites it into
  an English prompt with a small local Ollama model, controls the cloud GPU through ./dream-cloud, and renders frames on
  the Apple GPU when the page chooses "local".
- "worker" (on the cloud GPU instance): only renders frames on CUDA; reached through an SSH tunnel.

The page prepares every input frame (prompt feedback loop, camera, image, video, music) and sends it over a
WebSocket; the server runs one SD-Turbo / SDXL-Turbo image-to-image step and sends the result back.
Both roles listen on 127.0.0.1 only (the app also in the home network when started with --lan).

This file only puts the parts together (#189):

  both roles   web.py          the application object every part hangs its routes on
               render.py       the image models and one picture (with styles.py the only part that loads PyTorch)
               render_api.py   /ws, /make, /health, /stats
  the app      rights.py       keys, roles and what each may do, the middleware in front of every request
               settings.py     the settings table: defaults, ranges, what a guest may change, MIDI targets
               hub.py          the shared state, who is connected, apply and broadcast
               ctl.py          the control line /ctl and the feeds a device lends (camera, motion)
               scenes.py       playlists and scenes
               inputs.py       MIDI controllers, motion sensors (OSC), movement rules
               output.py       Syphon, the output windows and previews (/out, /view)
               eyes.py         Dreamy Eyes: painted faces, portraits, trance
               windows.py      dream windows
               cloud.py        the cloud GPU through ./dream-cloud
               measure.py      measurement runs
               media.py        uploads, the gallery, style reference pictures
               voice.py        voice to prompt, energy words
               mpfiles.py      the MediaPipe files of the movement detection
               net.py          this Mac's addresses and links, the https listener
               pages.py        the pages, /remote-info, the QR codes
"""
import asyncio
import os

from fastapi.staticfiles import StaticFiles

import config
import render
import render_api
from web import app

print(f"Dream ({config.ROLE}) on {render.device}.", flush=True)


class Static(StaticFiles):
    """#232: the pages' scripts and styles are checked with Dream before a browser uses its copy (ETag, so mostly a
    short "not modified") – after an update an open page never runs an old script beside a new page."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response

if config.ROLE == "app":
    app.mount("/static", Static(directory=os.path.join(config.HERE, "static")), name="static")
    # every part of the app (each hangs its routes on `app` when it is loaded), also the ones only other parts use:
    # `server.<part>` is where a test or a script finds it
    import cloud
    import ctl
    import eyes
    import hub
    import inputs
    import measure
    import media
    import mpfiles
    import net
    import output
    import pages
    import rights
    import scenes
    import settings
    import voice
    import windows

    app.middleware("http")(rights.guard)               # in front of every request: origin, role, what the role may ask
    render_api.guard = lambda sock: rights.ws_can(sock, "render")   # #148: rendering is for the stage, not for guests

    def _background(name: str, job):
        """A task that runs as long as Dream does, started with the server (kept in hub.live under its name)."""
        app.router.on_startup.append(lambda: hub.live.setdefault(name, asyncio.get_event_loop().create_task(job())))

    _background("cloud_watch", cloud.cloud_watch)      # #176
    app.router.on_shutdown.append(hub.save_now)        # #187: what save_soon put off
    if config.LAN:
        _background("https", lambda: net.https_serve(app))   # #145
        app.router.on_shutdown.append(net.https_stop)
    _background("windows", windows.windows_loop)       # #201
