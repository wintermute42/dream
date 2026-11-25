"""The cloud GPU (RunPod or Scaleway), started and stopped through ./dream-cloud. Its status is found out here, once
for everybody, and pushed to Dream Control and this Mac (#176)."""
import asyncio
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time

from fastapi import Form

import config
import hub
import i18n
import models
import outbox
import rights
from web import app

_job = {"proc": None, "log": os.path.join(tempfile.gettempdir(), "dream-cloud.log"), "action": ""}


def cloud_failure(log: str) -> dict | None:
    """Why the last start failed (#98), told plainly: the GPU quota, or dream-cloud's own error line."""
    p = _job["proc"]
    if _job["action"] != "start" or p is None or p.poll() in (None, 0):
        return None
    m = re.search(r"quota exceeded for resources? '?cp_servers_type_([A-Za-z0-9_]+)", log)
    if m:
        zone = (re.search(r" in (\S+)(?: an)? \([Ii]mage", log) or [None, ""])[1]
        return {"kind": "quota", "type": m.group(1).replace("_", "-"), "zone": zone}
    # dream-cloud and cloud_runpod.py mark their errors with "✖ " (#132; the German "Fehler:" of earlier versions)
    err = [ln.split(" ", 1)[-1].strip() for ln in log.splitlines() if ln.startswith(("✖ ", "Fehler:"))]   # German marker of earlier versions
    last = (err or log.strip().splitlines() or [i18n.t("unknown")])[-1]
    return {"kind": "error", "text": last[:200]}


# #238: where the cloud GPU stands, as one word the pages show as a step – found out from what dream-cloud reports of the
# machine and what the renderer on it says about itself (its /health: loading, downloading, compiling, ready):
#   machine      the GPU starts and is set up (no renderer answers yet)
#   download     the renderer downloads the model (a fresh machine does that on every start)
#   loading      the model is read and brought onto the GPU
#   compiling    the model is compiled for the GPU before its first picture: it does not paint yet
#   ready        the next picture comes at once – "unoptimized": painted uncompiled, because the model was not compiled
#                for this kind of picture (a new size or format, pose, outlines, a model switched on stage): slower, no pause
#   unreachable  a machine is there (and costs), but its renderer does not answer or has no model
#   stopping     the machine is being deleted
PREPARING = ("machine", "download", "loading", "compiling")
# from the start of a step until pictures come, roughly (RunPod RTX 4090, SDXL-Turbo, 2026-11-24: the machine about
# 1 minute until its renderer answers, the model's download well under a minute, loading a few seconds)
ROUGH_MIN = {"machine": 2, "download": 1, "loading": 1}
# with the compile cache of an earlier start, and without – square and 16:9 at 512 and 384 px (measured on an RTX 4090
# with SDXL-Turbo, 2026-11-24: 26 s with the cache, 309 s without; a little more is allowed for)
COMPILE_MIN = {True: 1, False: 5.5}
DOWNLOAD_GB_MIN = 20.0                                        # what a data centre's line brings, roughly (measured: more)
UNREADABLE_S = 60                                             # a status that cannot be read: the step stays that long
_work = {"phase": None, "since": 0.0, "misses": 0, "unread": None}


def work_phase(st: dict) -> str | None:
    state, busy = st.get("state"), st.get("busy")
    if state in ("setup", "error"):
        return None
    if busy and _job["action"] == "stop":
        return "stopping"
    if state == "off":
        return "machine" if busy else None
    w = st.get("worker")
    if not isinstance(w, dict):
        return "ready" if st.get("ready") else "machine" if busy else "unreachable"
    if w.get("failed"):
        return "unreachable"
    if w.get("compiling") and not w.get("painting"):   # a renderer that paints on while something compiles is ready
        return "compiling"
    if w.get("ready", st.get("ready")):                # a renderer of an earlier version: it answers once it is ready
        return "ready"
    return "download" if w.get("first_download") else "loading"


def cloud_work(st: dict, now: float | None = None) -> dict | None:
    """The step the cloud GPU is at, with a rough time until pictures come ("eta_min") and, while it downloads, how far
    ("percent"); None while there is no machine. One question without an answer does not make it unreachable."""
    now = time.time() if now is None else now
    if st.get("state") == "error":                     # dream-cloud could not ask the provider: for a while, as it was
        _work["unread"] = _work["unread"] or now
        phase = _work["phase"] if now - _work["unread"] < UNREADABLE_S else None
    else:
        _work["unread"], phase = None, work_phase(st)
    if phase == "unreachable" and _work["phase"] in (*PREPARING, "ready") and not _work["misses"]:
        _work["misses"], phase = 1, _work["phase"]
    elif phase != "unreachable":
        _work["misses"] = 0
    if phase != _work["phase"]:
        _work.update(phase=phase, since=now)
    if phase is None:
        return None
    out: dict = {"phase": phase}
    w = st.get("worker") if isinstance(st.get("worker"), dict) else {}
    left = None
    if phase == "compiling":
        left = COMPILE_MIN[bool(w.get("compile_cached"))] - float(w.get("compiling_s") or 0) / 60
    elif phase == "download" and w.get("download_gb") is not None and w.get("loading") in models.DOWNLOAD_GB:
        total = models.DOWNLOAD_GB[w["loading"]]
        done = min(1.0, float(w["download_gb"]) / total)
        out["percent"] = min(99, int(done * 100))
        left = (1 - done) * total / DOWNLOAD_GB_MIN + ROUGH_MIN["loading"]
    elif phase in ROUGH_MIN:
        left = ROUGH_MIN[phase] - (now - _work["since"]) / 60
    if left is not None:
        out["eta_min"] = max(1, math.ceil(left))
    if w.get("loading") in models.MODELS:
        out["model"] = w["loading"]
    if phase == "ready" and (w.get("unoptimized") or w.get("compiling")):
        out["unoptimized"] = True
    return out


def mac_notify(text: str) -> None:
    """A notification of macOS titled "Dream", so the owner hears of it with the panel out of sight (DREAM_NOTIFY=0:
    none). The text goes in as an argument, never as script."""
    if not config.NOTIFY or sys.platform != "darwin":
        return
    try:
        subprocess.run(["osascript", "-e", "on run argv", "-e", 'display notification (item 1 of argv) with title "Dream"',
                        "-e", "end run", text], capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as e:
        print("no notification:", repr(e)[:200], flush=True)


def ready_note(before: str | None, phase: str | None) -> str | None:
    """What to tell the owner when the cloud GPU has just become ready (None: nothing new)."""
    if phase != "ready" or before not in (*PREPARING, "unreachable"):
        return None
    if hub.state.get("backend") == "cloud":
        return i18n.t("The cloud GPU is ready – Dream computes on it now.")
    return i18n.t("The cloud GPU is ready – switch to it under “Computing”.")


# #176: the cloud's status is found out here, once for everybody, and pushed to Dream Control and this Mac –
# instead of every remote asking every few seconds (each question starts `dream-cloud status`). Often while a GPU
# starts, stops or runs, rarely while it is off, hardly at all while no provider is set up.
cloud_cache: dict = {"st": None, "kick": False}


async def cloud_watch():
    loop = asyncio.get_running_loop()
    while True:
        cloud_cache["kick"] = False
        before = _work["phase"]
        st = await loop.run_in_executor(None, cloud_read)
        note = ready_note(before, (st.get("work") or {}).get("phase"))
        if note:                                       # #238: also outside the pages
            loop.run_in_executor(None, mac_notify, note)
        if st != cloud_cache["st"]:
            cloud_cache["st"] = st
            for c, r in list(hub.roles.items()):
                if rights.can(r, "control"):
                    outbox.post(c, json.dumps({"cloud": st}))
        active = st.get("busy") or st.get("state") not in ("off", "setup", "error") or hub.state.get("backend") == "cloud"
        wait = 3 if active else 300 if st.get("state") == "setup" else 30
        for _ in range(wait):
            if cloud_cache["kick"]:
                break
            await asyncio.sleep(1)


@app.get("/cloud")
def cloud_status():
    """Dream Control and this Mac only (#176): the latest status the watcher found."""
    cloud_cache["kick"] = cloud_cache["st"] is None
    return cloud_cache["st"] or cloud_read()


def cloud_read() -> dict:
    busy = _job["proc"] is not None and _job["proc"].poll() is None
    try:
        r = subprocess.run([config.CLOUD, "status", "--json"], capture_output=True, text=True, timeout=40)
        st = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else \
            {"state": "error", "error": (r.stderr or r.stdout).strip()[-300:]}
    except Exception as e:
        st = {"state": "error", "error": str(e)[:300]}
    st["busy"] = busy
    try:
        with open(_job["log"]) as f:
            st["log"] = f.read()[-1500:]
    except FileNotFoundError:
        st["log"] = ""
    fail = cloud_failure(st["log"])
    if fail and st.get("state") == "off":
        st["fail"] = fail
    work = cloud_work(st)                              # #238
    if work:
        st["work"] = work
    return st


def _spawn(*args):
    if _job["proc"] is not None and _job["proc"].poll() is None:
        return False
    logf = open(_job["log"], "w")
    env = {**os.environ, "DREAM_LANG": i18n.current.get() or i18n.fallback["lang"]}   # #132: its messages in the page's language
    _job["proc"] = subprocess.Popen([config.CLOUD, *args], stdout=logf, stderr=subprocess.STDOUT, env=env)
    _job["action"] = args[0]
    return True


@app.post("/cloud/start")
def cloud_start(gpu: str = Form("runpod:RTX-4090"), model: str = Form("sd-turbo"), fallback: str = Form("")):
    extra = ["--fallback", fallback] if fallback else []   # #110: only what the owner agreed to, with its price
    if model == "sdxl-turbo" and hub.state.get("style_ref"):   # #131: a reference picture in use: compile with its adapter
        extra.append("--with-ref")
    started = _spawn("start", "--type", gpu, "--model", model, *extra)
    cloud_cache["kick"] = True                     # #176: look again at once
    return {"started": started}


@app.post("/cloud/stop")
def cloud_stop():
    if _job["proc"] is not None and _job["proc"].poll() is None:
        _job["proc"].terminate()
        _job["proc"].wait(timeout=10)
    stopping = _spawn("stop")
    cloud_cache["kick"] = True                     # #176
    return {"stopping": stopping}


def look_again() -> None:
    """#176: the watcher asks at once instead of waiting out its pause."""
    cloud_cache["kick"] = True


hub.on_change("backend", look_again)               # the cloud watcher looks more often while the cloud paints
