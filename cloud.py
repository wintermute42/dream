"""The cloud GPU (RunPod or Scaleway), started and stopped through ./dream-cloud. Its status is found out here, once
for everybody, and pushed to Dream Control and this Mac (#176)."""
import asyncio
import json
import os
import re
import subprocess
import tempfile

from fastapi import Form

import config
import hub
import i18n
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


# #176: the cloud's status is found out here, once for everybody, and pushed to Dream Control and this Mac –
# instead of every remote asking every few seconds (each question starts `dream-cloud status`). Often while a GPU
# starts, stops or runs, rarely while it is off, hardly at all while no provider is set up.
cloud_cache: dict = {"st": None, "kick": False}


async def cloud_watch():
    loop = asyncio.get_running_loop()
    while True:
        cloud_cache["kick"] = False
        st = await loop.run_in_executor(None, cloud_read)
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
