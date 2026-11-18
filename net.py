"""This Mac in the home network: its address, the links and QR targets of every page, and the second listener with
TLS (#145) that Dream Control and Dreamy Eyes use."""
import asyncio
import contextlib
import os
import socket
import subprocess
import sys

import config
import hub
import i18n
import rights

TLS_DIR = os.path.join(hub.STATE_DIR, "tls")
tls_state = {"on": False, "error": ""}


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))      # no packet is sent; only picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def remote_url() -> str:
    return f"http://{lan_ip()}:{config.PORT}/remote?k={rights.keys['guest']}"


def control_url() -> str:
    """#148: Dream Control – the full remote; only shown on this Mac. #145: over https once the certificate stands."""
    if tls_state["on"]:
        return f"https://{lan_ip()}:{config.HTTPS_PORT}/control?k={rights.keys['control']}"
    return f"http://{lan_ip()}:{config.PORT}/control?k={rights.keys['control']}"


def window_url() -> str:
    """#201: a dream window – plain http (it needs no camera), so older devices without the certificate work too."""
    return f"http://{lan_ip()}:{config.PORT}/window?k={rights.keys['window']}"


def eyes_url() -> str:
    """#156: Dreamy Eyes – the camera needs https (the browser gives it out only there)."""
    if tls_state["on"]:
        return f"https://{lan_ip()}:{config.HTTPS_PORT}/eyes?k={rights.keys['eyes']}"
    return f"http://{lan_ip()}:{config.PORT}/eyes?k={rights.keys['eyes']}"


def ca_url() -> str:
    """#145: the certificate of Dream's own authority, to install once per device (public: no key needed)."""
    return f"http://{lan_ip()}:{config.PORT}/dream-ca.crt"


def local_hostnames() -> list[str]:
    names = [socket.gethostname()]
    if sys.platform == "darwin":
        with contextlib.suppress(Exception):
            names.insert(0, subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True, text=True,
                                           timeout=3).stdout.strip() + ".local")
    return [n for n in names if n.lower().endswith(".local")]


async def https_serve(app):
    """#145: a second listener with TLS in this process (same state, same app); http stays for the guests."""
    import uvicorn

    import tls
    if config.HTTPS_PORT in (config.PORT, config.CLOUD_TUNNEL_PORT):    # #153: would take the port of the panel or the cloud tunnel
        tls_state["error"] = i18n.t("Port {port} is taken by Dream itself – choose another DREAM_HTTPS_PORT.", port=config.HTTPS_PORT)
        print("https:", tls_state["error"], flush=True)
        return
    try:
        cert, key = await asyncio.to_thread(tls.ensure_server, TLS_DIR, [lan_ip()], local_hostnames())
    except Exception as e:
        tls_state["error"] = str(e)[:200]
        print("https:", e, flush=True)
        return

    class Listener(uvicorn.Server):
        @contextlib.contextmanager
        def capture_signals(self):                 # the main server owns Ctrl+C
            yield

    server = Listener(uvicorn.Config(app, host="0.0.0.0", port=config.HTTPS_PORT, ssl_certfile=cert, ssl_keyfile=key,
                                     lifespan="off", log_level="warning", ws_max_size=16 * 1024 * 1024))
    hub.live["https_server"] = server
    tls_state["on"] = True
    print(i18n.t("Dream Control over https on port {port}.", port=config.HTTPS_PORT), flush=True)
    try:
        await server.serve()
    except (OSError, SystemExit) as e:
        print("https:", e, flush=True)
    finally:
        tls_state["on"] = False


async def https_stop():
    """On Ctrl+C the https listener closes its connections itself, like the main server – instead of having its
    open sockets cancelled under it when the program ends (which printed long tracebacks)."""
    server, task = hub.live.get("https_server"), hub.live.get("https")
    if server:
        server.should_exit = True
    if task:
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await asyncio.wait_for(task, 5)


def output_url() -> str:
    """The output page for a second device at the beamer (the guests' key: it can only watch and steer like one)."""
    return f"http://{lan_ip()}:{config.PORT}/output?k={rights.keys['guest']}"
