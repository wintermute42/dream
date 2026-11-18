"""#206: every QR code is shown by the one lightbox (static/qrbox.js) – loaded on opening, thrown away on closing."""
import os
import re

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
PAGES = ("index.html", "remote.html")


def read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def test_pages_use_the_shared_lightbox():
    for page in PAGES:
        src = read(page)
        assert '<script src="/static/qrbox.js"></script>' in src, page
        assert '<link rel="stylesheet" href="/static/qrbox.css">' in src, page
        assert "QrBox.open(" in src, page


def test_no_page_shows_a_code_by_itself():
    """Only qrbox.js asks for /qr.svg: a code standing in a page would keep its key on the screen."""
    for page in sorted(f for f in os.listdir(STATIC) if f.endswith(".html")):
        assert "qr.svg" not in read(page), page


def test_lightbox_is_a_modal_dialog_that_drops_the_code():
    src = read("qrbox.js")
    for needed in ("'role', 'dialog'", "'aria-modal', 'true'", "'aria-labelledby', 'qrbox-title'", "showModal()"):
        assert needed in src, needed
    closing = src[src.index("addEventListener('close'"):]
    assert "empty()" in closing[:200]
    assert "img.removeAttribute('src')" in src[src.index("function empty()"):src.index("function fail()")]


def test_lightbox_moves_only_with_transform_and_opacity():
    css = read("qrbox.css")
    assert "prefers-reduced-motion: reduce" in css
    for frames in re.findall(r"@keyframes [\w-]+ \{(.*)\}\s*$", css, re.M):
        props = set(re.findall(r"([a-z-]+)\s*:", frames))
        assert props <= {"opacity", "transform"}, props
    assert "transition" not in css
