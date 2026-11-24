"""#232: after an update an open page must not run an old script from the browser's cache beside a new page."""
from starlette.testclient import TestClient


def test_scripts_and_styles_are_checked_before_a_browser_uses_its_copy(server):
    local = TestClient(server.app, base_url="http://127.0.0.1:7860", client=("127.0.0.1", 50000))
    for path in ("/static/common.js", "/static/sliders.css"):
        r = local.get(path)
        assert r.status_code == 200 and r.headers["cache-control"] == "no-cache" and r.headers.get("etag"), path
        again = local.get(path, headers={"If-None-Match": r.headers["etag"]})
        assert again.status_code == 304, path        # unchanged: a short "not modified", nothing sent again
