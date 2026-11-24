"""#231: RunPod's RTX 4090 is the cloud GPU Dream takes unless told otherwise – in the server and in dream-cloud – while
the Scaleway types stay usable from the command line. (What the pages offer: tests/js/cloud-gpus.test.mjs.)"""
import inspect
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCALEWAY = ("L4-1-24G", "L40S-1-48G", "H100-1-80G")


def test_the_server_starts_runpod_unless_told_otherwise(server):
    assert inspect.signature(server.cloud.cloud_start).parameters["gpu"].default.default == "runpod:RTX-4090"


def test_dream_cloud_starts_runpod_unless_told_otherwise():
    script = (ROOT / "dream-cloud").read_text(encoding="utf-8")
    start = script[script.index("cmd_start() {"):]
    assert re.search(r'^\s*local type="runpod:RTX-4090" ', start, re.M)
    assert not re.search(r'type="(%s)"' % "|".join(SCALEWAY), script)


def test_dream_cloud_still_takes_the_scaleway_types():
    script = (ROOT / "dream-cloud").read_text(encoding="utf-8")
    accepted = re.search(r'case "\$type" in ([^)]+)\) ;; \*\) die "\$\(tx "unknown GPU type', script).group(1).split("|")
    assert set(SCALEWAY) < set(accepted) and "runpod:RTX-4090" in accepted
    for gpu in SCALEWAY:
        assert f"{gpu}) echo " in script, f"no price for {gpu}"
