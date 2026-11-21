"""dream-cloud starts cloud_runpod.py with python3 -I (isolated): it must still find Dream's own modules."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_runs_in_isolated_mode(tmp_path):
    r = subprocess.run([sys.executable, "-I", str(ROOT / "cloud_runpod.py")], capture_output=True, text=True,
                       cwd=tmp_path, timeout=30)
    assert "ModuleNotFoundError" not in r.stderr, r.stderr
    assert r.returncode != 0 and "cloud_runpod.py" in r.stderr     # the usage line, not a crash
