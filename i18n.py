"""Texts of the server, dream-cloud and cloud_runpod.py in the user's language (#132).

The code is written in English; static/i18n/<lang>.json (the same files the pages use) maps an English text to its
translation. The language: per request the page's cookie "dream-lang" (set in `current`), otherwise the language of
the last stage that connected, otherwise DREAM_LANG or the system's LANG.

  python3 i18n.py LANG 'Text with {0} and {1}' A B     prints the text in LANG (for dream-cloud; LANG may be empty)
"""
from __future__ import annotations

import contextvars
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LANGS = ("de", "en")
current: contextvars.ContextVar = contextvars.ContextVar("dream_lang", default=None)


def _system_lang() -> str:
    env = os.environ.get("DREAM_LANG") or os.environ.get("LC_ALL") or os.environ.get("LANG") or ""
    return "de" if env.lower().startswith("de") else "en"


fallback = {"lang": _system_lang()}           # the last stage's language (server), or the system's
_dicts: dict = {}


def _dict(lang: str) -> dict:
    if lang not in _dicts:
        try:
            with open(os.path.join(HERE, "static", "i18n", lang + ".json"), encoding="utf-8") as f:
                d = json.load(f)
            d.pop("_names", None)
        except (OSError, ValueError):
            d = {}
        _dicts[lang] = d
    return _dicts[lang]


def t(text: str, lang: str | None = None, **values) -> str:
    """The text in the language (English: as written); {name} is filled in from values."""
    lang = lang if lang in LANGS else (current.get() or fallback["lang"])
    s = _dict(lang).get(text, text) if lang != "en" else text
    if not values:
        return s
    return re.sub(r"\{(\w+)\}", lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), s)   # unknown {x} stays


def msg(m) -> str | None:
    """A message kept as (English text, values) – translated where it is shown – or a plain text."""
    if not m:
        return None
    if isinstance(m, tuple):                  # values that are texts of their own (a style's name) are translated too
        return t(m[0], **{k: t(v) if isinstance(v, str) else v for k, v in m[1].items()})
    return t(m)


def from_cookie(value: str | None) -> str | None:
    """The language a page chose (its cookie), if it is one Dream speaks."""
    return value if value in LANGS else None


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 2:
        sys.exit("usage: i18n.py LANG TEXT [VALUES …]")
    print(t(a[1], a[0] or _system_lang(), **{str(i): v for i, v in enumerate(a[2:])}))
