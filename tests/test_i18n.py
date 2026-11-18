"""Translations (#132, #133): scripts/i18n_check.py reports nothing missing and no German outside the translations."""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_i18n_check():
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "i18n_check.py")], cwd=ROOT,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    for problem in ("missing in de.json", "placeholders differ", "German outside the translations"):
        assert problem not in r.stdout
