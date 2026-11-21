"""RunPod for dream-cloud (#104): find, create and delete Dream's GPU pod through RunPod's REST API v2.

The API key is read from the macOS keychain (service "runpod-api-key", account "dream"); it is never written to a
file, printed or logged. DREAM_RUNPOD_KEY and DREAM_RUNPOD_API exist for tests only (a fake API, no real pods).

  python3 cloud_runpod.py find                 one line "id status gpu host port cost_usd_h", nothing if no pod
  python3 cloud_runpod.py create GPU           creates the pod in a European data center, prints its id
  python3 cloud_runpod.py delete ID            deletes it (nothing left that costs)
  python3 cloud_runpod.py check                exit 0 when a key is there and the API answers
Errors go to stderr as one line starting with "✖ ", in the user's language (DREAM_LANG; dream-cloud shows them in the panel).
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

# dream-cloud runs this file with python3 -I (isolated: no script folder on sys.path), so add Dream's folder by hand
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import i18n  # noqa: E402

API = os.environ.get("DREAM_RUNPOD_API", "https://api.runpod.io/v2")
NAME = "dream-gpu"
# the panel's choice → RunPod's GPU type ids
# (no L40S: for Dream no faster than the RTX 4090, but dearer – owner's decision 2026-11-16)
GPUS = {"RTX-4090": "NVIDIA GeForce RTX 4090", "RTX-5090": "NVIDIA GeForce RTX 5090", "H100": "NVIDIA H100 80GB HBM3"}
# European data centers: short way to the Mac (Romania, Sweden, Netherlands, Czechia, France, Iceland, Norway)
EUROPE = ["EU-RO-1", "EU-SE-1", "EU-NL-1", "EU-CZ-1", "EU-FR-1", "EUR-IS-1", "EUR-IS-2", "EUR-IS-3", "EUR-NO-1"]
IMAGE = "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404"
# No CUDA filter at creation: RunPod's minCudaVersion turned away hosts that had a newer driver (a pod reported
# CUDA 13.2 while "13.0" and "12.6" found nothing). dream-cloud checks the driver on the machine and puts the
# matching PyTorch build there instead, or stops with a clear message.


NO_GPU = 3                    # exit code: the GPU is not free right now (dream-cloud may fall back, #110)


def fail(text, code=1, **values):
    print("✖ " + i18n.t(text, **values), file=sys.stderr)
    sys.exit(code)


def key():
    k = os.environ.get("DREAM_RUNPOD_KEY")
    if k:
        return k
    try:
        k = subprocess.run(["security", "find-generic-password", "-a", "dream", "-s", "runpod-api-key", "-w"],
                           capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        k = ""
    if not k:
        fail("No RunPod key in the keychain: security add-generic-password -a dream -s runpod-api-key -w")
    return k


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + key(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read() or b"{}")
        except ValueError:
            detail = {}
        msg = str(detail.get("detail") or detail.get("title") or detail.get("error") or e.reason)
        low = msg.lower()
        if e.code in (401, 403):
            fail("RunPod refuses the key ({m}). Rights: REST API → read and write pods.", m=msg)
        if "balance" in low or "credit" in low or "insufficient" in low:
            fail("No credit at RunPod – top it up in the RunPod console under Billing → Load credits.")
        if "no longer any instances" in low or ("no " in low and ("available" in low or "capacity" in low)) or e.code == 409:
            fail("No fitting GPU free in Europe right now – choose another GPU or try again in a few minutes.", NO_GPU)
        fail("RunPod answers with {c}: {m}", c=e.code, m=msg[:200])
    except (urllib.error.URLError, OSError) as e:
        fail("RunPod not reachable ({e}).", e=e)


def pods():
    d = call("GET", "/pods")
    items = d.get("pods", []) if isinstance(d, dict) else d
    return [p for p in items or [] if p.get("name") == NAME and p.get("status") != "TERMINATED"]


def ssh_of(p):
    direct = (p.get("ssh") or {}).get("direct") or {}
    return direct.get("host") or "-", int(direct.get("port") or 0)


def cmd_find():
    for p in pods():
        if p.get("status") == "RUNNING":              # the list leaves out the SSH port: the pod's own view has it
            p = call("GET", f"/pods/{p['id']}")
        host, port = ssh_of(p)
        gpu = next((k for k, v in GPUS.items() if v == (p.get("gpu") or {}).get("id")), "GPU")
        if p.get("cloud") == "COMMUNITY":
            gpu += "-community"
        print(p["id"], p.get("status", "?"), gpu, host, port, p.get("cost") or 0)
        return


def public_key():
    for name in ("id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"):
        path = os.path.expanduser("~/.ssh/" + name)
        if os.path.isfile(path):
            with open(path) as f:
                return f.read().strip()
    fail("No SSH key on this Mac (~/.ssh/id_rsa.pub): run ssh-keygen.")


def cmd_create(choice):
    # "…-community": RunPod's Community Cloud – machines of private providers, often cheaper and more often free;
    # the pictures are then processed on such a machine instead of in a RunPod data center (the owner chooses it)
    community = choice.endswith("-community")
    choice = choice.removesuffix("-community")
    if choice not in GPUS:
        fail("unknown RunPod GPU {g}", g=choice)
    if pods():
        fail("A Dream pod is already running.")
    body = {"name": NAME, "image": IMAGE, "cloud": "COMMUNITY" if community else "SECURE", "dataCenterIds": EUROPE,
            "gpu": {"id": GPUS[choice], "count": 1},
            "disk": 60, "ports": ["22/tcp"],
            # the Mac's public key: the image starts sshd with it (no key needs to be registered at RunPod)
            "env": {"PUBLIC_KEY": public_key()}}
    d = call("POST", "/pods", body)
    if d.get("queued") or d.get("status") == "QUEUED" or (not d.get("id") and d.get("queuedPod")):
        q = d.get("id") or (d.get("queuedPod") or {}).get("id")
        if q:
            call("DELETE", f"/queued-pods/{q}")
        fail("No fitting GPU free in Europe right now – choose another GPU or try again in a few minutes.", NO_GPU)
    if not d.get("id"):
        fail("RunPod did not create a pod.")
    print(d["id"])


def cmd_delete(pid):
    call("DELETE", f"/pods/{pid}")


def cmd_check():
    call("GET", "/pods")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["find"]:
        cmd_find()
    elif a[:1] == ["create"] and len(a) == 2:
        cmd_create(a[1])
    elif a[:1] == ["delete"] and len(a) == 2:
        cmd_delete(a[1])
    elif a[:1] == ["check"]:
        cmd_check()
    else:
        fail("usage: cloud_runpod.py find | create GPU | delete ID | check")
