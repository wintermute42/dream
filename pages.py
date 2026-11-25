"""The pages of the app and what they need to find each other: the stage, the remote (also as Dream Control), the
certificate of Dream's own authority, the links and their QR codes."""
import io
import os

from fastapi import Request
from fastapi.responses import FileResponse, Response

import config
import net
import rights
from web import app


@app.get("/")
def index():
    return FileResponse(os.path.join(config.HERE, "static", "index.html"))


@app.get("/dance")
def dance_page():
    """#251: the page of the mode Dream Dance – on this Mac only (rights.LOCAL_ONLY), opened from the panel."""
    return FileResponse(os.path.join(config.HERE, "static", "dance.html"))


@app.get("/flowtrack")
def flowtrack_page():
    """#252: the page of the mode Flowtrack – on this Mac only (rights.LOCAL_ONLY), opened from the panel."""
    return FileResponse(os.path.join(config.HERE, "static", "flowtrack.html"))


@app.get("/remote")
def remote_page():
    return FileResponse(os.path.join(config.HERE, "static", "remote.html"))


@app.get("/control")
def control_page():
    """#145: the same remote as an installable app of its own ("Dream Control", own manifest and start address)."""
    page = open(os.path.join(config.HERE, "static", "remote.html"), encoding="utf-8").read()
    page = page.replace("/static/remote.webmanifest", "/static/control.webmanifest", 1)
    page = page.replace("<title>Dream · Remote</title>", "<title>Dream Control</title>", 1)
    return Response(page, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})


@app.get("/dream-ca.crt")
def ca_cert():
    """#145: Dream's own certificate authority, to install once on each of the owner's devices."""
    import tls
    path = tls.paths(net.TLS_DIR)["ca"]
    if not config.LAN or not os.path.exists(path):
        return Response(status_code=404)
    return FileResponse(path, media_type="application/x-x509-ca-cert", filename="dream-ca.crt")


@app.get("/remote-info")
def remote_info(request: Request):
    lan, role = config.LAN, request.state.role
    if rights.can(role, "pair_eyes"):                     # #156: Dream Control sets up the Dreamy Eyes phone
        return {"lan": lan, "eyes": net.eyes_url() if lan else None, "window": net.window_url() if lan else None,
                "https": net.tls_state["on"], "source": config.SOURCE_URL}
    if not rights.can(role, "stage"):
        return {"lan": lan, "source": config.SOURCE_URL}   # #178: everybody may see where the code is
    return {"lan": lan, "source": config.SOURCE_URL, "url": net.remote_url() if lan else None, "output": net.output_url() if lan else None,
            "control": net.control_url() if lan else None, "window": net.window_url() if lan else None, "https": net.tls_state["on"],
            "https_error": net.tls_state["error"], "ca": net.ca_url() if lan and net.tls_state["on"] else None}


@app.get("/qr.svg")
def qr_svg(request: Request):
    what = request.query_params.get("for")
    role = request.state.role                      # every code for this Mac; #156, #201: Control pairs eyes and windows
    if not config.LAN or not (rights.can(role, "stage") or (rights.can(role, "pair_eyes") and what in ("eyes", "window"))):
        return Response(status_code=404)
    import qrcode
    import qrcode.image.svg
    url = {"output": net.output_url, "control": net.control_url, "ca": net.ca_url, "eyes": net.eyes_url, "window": net.window_url}.get(what, net.remote_url)()
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathFillImage, box_size=12, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")
