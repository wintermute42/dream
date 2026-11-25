#!/usr/bin/env python3
"""Checks the translations (#132, #133): every English text the pages, the server, dream-cloud and cloud_runpod.py
show must have its German in static/i18n/de.json, with the same {placeholders}; and no German stands anywhere else in
the repository (except README.de.md and the names of earlier versions). Exit 1 if something is wrong.

  python3 scripts/i18n_check.py            report missing and unused texts
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["static/index.html", "static/remote.html", "static/output.html", "static/eyes.html", "static/window.html", "static/dance.html", "static/flowtrack.html"]
SCRIPTS = ["static/motion.js", "static/calib.js", "static/fx.js", "static/qrbox.js", "static/common.js", "static/sliders.js", "static/signs.js", "static/worldband.js",
           "static/compute.js", "static/danceslots.js", "static/dancepanel.js", "static/dancelab.js", "static/movecard.js", "static/movepage.js", "static/flowauto.js", "static/moveteach.js", "static/danceintro.js", "static/huecard.js"]
PY = sorted(f for f in os.listdir(ROOT) if f.endswith(".py"))   # #189: every module of the server and the scripts
ATTRS = ("title", "aria-label", "placeholder", "alt", "label")
STR = r"""(['"])((?:\\.|(?!\1).)*)\1"""


def unescape(s: str) -> str:
    return re.sub(r"\\(.)", r"\1", s)


class Markup(HTMLParser):
    """The visible texts of a page outside its scripts and styles (what I18N.apply translates)."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.texts = [], []

    def handle_starttag(self, tag, attrs):
        if tag not in ("br", "img", "input", "meta", "link", "source", "hr"):
            self.stack.append(tag)
        for k, v in attrs:
            if k in ATTRS and v:
                self.texts.append((self.getpos()[0], v))

    def handle_startendtag(self, tag, attrs):
        for k, v in attrs:
            if k in ATTRS and v:
                self.texts.append((self.getpos()[0], v))

    def handle_endtag(self, tag):
        if tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass

    def handle_data(self, data):
        if self.stack and self.stack[-1] in ("script", "style", "textarea"):
            return
        text = " ".join(data.split())
        if text:
            self.texts.append((self.getpos()[0], text))


def wordy(text: str) -> bool:
    """A text a person reads (not a number, a unit, a symbol or a code)."""
    return bool(re.search(r"[A-Za-z]{2,}", text)) and not re.fullmatch(r"[\d\s.,:×x%px/·–-]*(px|fps|ms|BPM|MB|GB)?", text)


def used_texts():
    found = []
    for f in PAGES:
        src = open(os.path.join(ROOT, f), encoding="utf-8").read()
        p = Markup()
        p.feed(src)
        found += [(f, ln, t) for ln, t in p.texts if wordy(t)]
    for f in PAGES + SCRIPTS:
        for ln, line in enumerate(open(os.path.join(ROOT, f), encoding="utf-8"), 1):
            for m in re.finditer(r"\bT\(" + STR, line):
                found.append((f, ln, unescape(m.group(2))))
    for f in PY:
        for ln, line in enumerate(open(os.path.join(ROOT, f), encoding="utf-8"), 1):
            for m in re.finditer(r"\b(?:i18n\.t|fail)\(" + STR, line):
                found.append((f, ln, unescape(m.group(2))))
            for m in re.finditer(r"""state\["error"\] = \(""" + STR, line):
                found.append((f, ln, unescape(m.group(2))))
            for m in re.finditer(r"""self\.error = \(""" + STR, line):
                found.append((f, ln, unescape(m.group(2))))
    for f in ("dream-cloud", "dream.sh", "install-autostart.sh"):
        for ln, line in enumerate(open(os.path.join(ROOT, f), encoding="utf-8"), 1):
            for m in re.finditer(r"""\btx """ + STR, line):
                found.append((f, ln, unescape(m.group(2))))
    return found


GERMAN = re.compile(r"[äöüÄÖÜß„]")
STOP = {"und", "nicht", "oder", "der", "die", "das", "ist", "wird", "mit", "für", "auf", "ein", "eine", "bei", "vom",
        "zum", "zur", "nach", "noch", "jetzt", "schon", "nur", "wenn", "dann", "auch", "aber", "kein", "keine", "sich"}
# where German is right: the translations, the German manual, and the names of earlier versions mapped to today's
# #179: single words that are German only (one is enough) – leftovers like a regex on a German text or a fixed label
GERMAN_WORDS = {"abschalten", "abschaltung", "gewechselt", "modell", "bitte", "verbunden", "abbrechen", "speichern",
                "löschen", "schließen", "zurück", "automatische", "fehler", "läuft", "starten", "gestartet"}
GERMAN_OK = ("static/i18n/", "README.de.md", ".venv/", ".git/", "uv.lock", "scripts/i18n_check.py")


def german_lines():
    """Lines with German outside the translations (#133: everything in the repository is English)."""
    out = []
    for dirpath, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in (".git", ".venv", "__pycache__", "node_modules")]
        for name in files:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, ROOT)
            if rel.startswith(GERMAN_OK) or not name.endswith((".py", ".js", ".html", ".md", ".toml", ".json", ".sh")) \
                    and name not in ("dream-cloud",):
                continue
            for ln, line in enumerate(open(path, encoding="utf-8", errors="replace"), 1):
                if "OLD_" in line or "earlier version" in line or "German" in line or "Deutsch" in line:
                    continue                            # a mapping or a note about the old German names
                words = [w.lower() for w in re.findall(r"[A-Za-zÄÖÜäöüß]+", line)]
                if GERMAN.search(line) or sum(w in STOP for w in words) >= 2 or GERMAN_WORDS & set(words) \
                        or re.search(r"\bca\. ", line):
                    out.append(f"{rel}:{ln}: {line.strip()[:120]}")
    return out


def main():
    de = json.load(open(os.path.join(ROOT, "static/i18n/de.json"), encoding="utf-8"))
    de.pop("_names", None)
    missing, wrong = [], []
    used = set()
    for f, ln, text in used_texts():
        used.add(text)
        if text not in de:
            missing.append(f"{f}:{ln}: {text}")
        elif set(re.findall(r"\{\w+\}", text)) != set(re.findall(r"\{\w+\}", de[text])):
            wrong.append(f"{f}:{ln}: {text}  →  {de[text]}")
    unused = sorted(k for k in de if k not in used)
    german = german_lines()
    for title, items in (("missing in de.json", missing), ("placeholders differ", wrong), ("German outside the translations", german)):
        if items:
            print(f"{len(items)} {title}:")
            print("\n".join("  " + i for i in sorted(set(items))))
    if unused:
        print(f"{len(unused)} unused in de.json (may be built at run time):")
        print("\n".join("  " + u for u in unused))
    print(f"checked {len(used)} texts, de.json has {len(de)}")
    sys.exit(1 if missing or wrong or german else 0)


if __name__ == "__main__":
    main()
