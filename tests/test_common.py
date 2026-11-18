"""#189: what the pages share lives in static/common.js – no page keeps its own copy."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ("index.html", "remote.html", "eyes.html", "window.html", "output.html")
KEYED = ("remote.html", "eyes.html", "window.html", "output.html")      # opened with a key in the address


def read(name: str) -> str:
    with open(os.path.join(ROOT, "static", name), encoding="utf-8") as f:
        return f.read()


def test_every_page_loads_the_shared_file():
    for page in PAGES:
        assert re.search(r'<script src="/static/common\.js"( data-hide-key)?></script>', read(page)), page


def test_pages_opened_with_a_key_take_it_out_of_the_address():
    """#175: the key stays in the cookie – the shared file removes it from the address, before anything else runs."""
    for page in KEYED:
        src = read(page)
        tag = '<script src="/static/common.js" data-hide-key></script>'
        assert tag in src and src.index(tag) < src.index("</head>"), page
        assert "searchParams.delete('k')" not in src, page
    common = read("common.js")
    assert "searchParams.delete('k')" in common and "history.replaceState" in common
    assert "dataset.hideKey !== undefined) hideKey()" in common


def test_no_page_keeps_its_own_copy():
    shared = (r"function askStart\b", r"const FALLBACK\b", r"const optText\b", r"function galleryUndo\b",
              r"async function galleryAct\b", r"async function keepAwake\b", r"navigator\.wakeLock", r"bufferedAmount > 300000",
              r"localStorage\.(get|set)Item\('dream-r?ui-'", r"replace\(/&/g, '&amp;'\)", r"fetch\('/playlists")
    # the dream window keeps the screen on with its own, differently built video (1 px, fully transparent): which of
    # the two a given old device needs is not known, so it stays as it was
    own = {"window.html": {r"navigator\.wakeLock"}}
    for page in PAGES:
        src = read(page)
        for pattern in shared:
            if pattern not in own.get(page, ()):
                assert not re.search(pattern, src), f"{page} has its own {pattern}"


def test_the_shared_file_offers_what_the_pages_call():
    common = read("common.js")
    offered = set(re.search(r"return \{ ([\w, ]+) \};\n\}\)\(\);", common).group(1).split(", "))
    for page in PAGES:
        for name in set(re.findall(r"DreamCommon\.(\w+)", read(page))):
            assert name in offered, f"{page} calls DreamCommon.{name}"
