"""The panel on the Mac is the main control (#241): Dream Control (static/remote.html, role control) never offers more
than the panel (static/index.html) – every setting it changes, every command and message it sends, every button and
every choice of its lists is in the panel too. Only what the phone itself contributes stays Dream Control's alone
(PHONE_ONLY): lending its camera, its motion and its glowing screen, and how that one page looks on that one device.

A new control in Dream Control fails here until the panel has it too (or, if it is a feature of the phone itself, until
it is named in PHONE_ONLY with its reason)."""
import asyncio
import json
import os
import re

import pytest

import settings
from test_rights import client, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401  (the roles' devices; nothing left behind)

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")


def read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


REMOTE, PANEL = read("remote.html"), read("index.html")


def ids(html: str) -> set:
    return set(re.findall(r'<(?:input|select|button|textarea)[^>]*\bid="([\w-]+)"', html))


def options(html: str, select_id: str) -> list:
    m = re.search(r'<select[^>]*\bid="' + select_id + r'"[^>]*>(.*?)</select>', html, re.S)
    assert m, select_id
    return re.findall(r'<option value="([^"]*)"', m.group(1))


def seg(html: str, box_id: str, attr: str) -> list:
    m = re.search(r'id="' + box_id + r'"[^>]*>(.*?)</div>', html, re.S)
    assert m, box_id
    return re.findall(r'data-' + attr + r'="([^"]*)"', m.group(1))


def panel_code() -> str:
    """The panel's page with the scripts it loads (its parts: common.js, movecard.js, …)."""
    names = re.findall(r'<script src="/static/([\w.-]+\.js)"', PANEL)
    return PANEL + "".join(read(n) for n in names)


PANEL_CODE = panel_code()


def wired(el_id: str) -> bool:
    """The panel's script reaches the element (by its id, or a part by its class of the same name)."""
    return any(p in PANEL_CODE for p in (f"$('{el_id}')", f"'#{el_id}'", f"#{el_id} ", f"'{el_id}'", f"$('.{el_id}')"))


# What the phone contributes itself, or how this one page looks on this one device – never a control of Dream.
PHONE_ONLY = {
    # #146/#237: lending the phone's own camera, motion and glowing screen ("This device")
    "devcam": "lends this phone's live camera", "devfacing": "which of this phone's cameras",
    "devmotion": "lends this phone's motion", "devtarget": "what this phone's motion steers (the panel: senstarget)",
    "devlearn": "learns this phone's motion (the panel: senslearn)",
    "devimpulse": "what a strike of this phone does (the panel: sensimpulse)",
    "devglow": "this phone's screen glows as a light marker", "glowend": "ends this phone's glow",
    "glowclutch": "the clutch on the glowing screen (the panel: clutchbtn)",
    # the page itself on this device: its view, its live preview, its role, installing it
    "uishow": "this page's show view", "uismaller": "this page's type size", "uibigger": "this page's type size",
    "uinight": "this page's night colours", "uifs": "this page in fullscreen", "bar-fs": "this page in fullscreen",
    "fsagain": "this page in fullscreen", "fsno": "this page in fullscreen",
    "pvbtn": "a live preview of the stage (the panel is the stage)", "pvclose": "the large live preview",
    "takectl": "this device takes over the role Dream Control", "installapp": "installs this page as an app",
}
# Dream Control's control → the panel's control that does the same, where the two are named differently
SAME_AS = {
    "next": "nextscene", "bar-next": "nextscene", "bar-run": "run", "bar-auto": "autobtn", "bar-strength": "strength",
    "bar-master": "master", "bar-black": "blackout", "black": "blackout", "qr": "qrbtn", "send": "prompt",
    "file": "imgpick", "flowmode": "modes", "trance": "trancego", "eyesqr": "eyesshow", "winqr": "winshow",
    "devend": "feedend", "dl-rec": "labrec", "dl-open": "movepage",
}
# the commands Dream Control sends → the panel's control that does it (on the Mac it runs at once, no message)
CMD_IN_PANEL = {
    "next": "nextscene", "restart": "restart", "qr": "qrbtn", "imgclear": "srcclear", "vidclear": "srcclear",
    "make": "makeimg", "tap": "tapbtn", "tapoff": "tapoff", "relieve": "relieve", "relieve_undo": "relieveundo",
    "dance_rec": "labrec", "dance_lab": "movepage", "blackout": "blackout",
}
PHONE_ONLY_CMDS = {"relieve_ask": "the phone asks the stage how it is doing, to show it"}
PHONE_ONLY_MSGS = {"feed": "lends this phone's camera or motion", "motion_in": "this phone's motion",
                   "glow": "this phone's screen glows", "take_control": "this device takes over the role"}
# the parts both pages mount: what such a part sends, it sends from either page
SHARED_PARTS = ("WorldBand.mount", "MoveCard.mount", "DreamSliders.resetButton", "DreamCommon.gallery", "DreamCompute.draw")


def test_every_control_of_dream_control_is_in_the_panel():
    panel = ids(PANEL) | {"modes"}
    missing = []
    for el in sorted(ids(REMOTE)):
        if el in PHONE_ONLY:
            continue
        theirs = SAME_AS.get(el, el)
        if theirs not in panel or not wired(theirs):
            missing.append((el, theirs))
    assert not missing, f"Dream Control offers what the panel lacks: {missing}"
    # the lists are honest: nothing in them that is not there any more
    assert set(PHONE_ONLY) <= ids(REMOTE) and set(SAME_AS) <= ids(REMOTE)
    assert not set(PHONE_ONLY) & set(SAME_AS)


def remote_settings() -> set:
    fields = re.search(r"const FIELDS = \[([^\]]*)\]", REMOTE).group(1)
    keys = set(re.findall(r"'(\w+)'", fields))
    keys |= set(re.findall(r"setKey\('(\w+)'", REMOTE)) | set(re.findall(r"data-setting=\"(\w+)\"", REMOTE))
    keys |= set(re.findall(r"set: \{ (\w+)", REMOTE))
    return keys


def panel_settings() -> set:
    bind = re.search(r"const BIND = \{(.*?)\};", PANEL, re.S).group(1)
    return set(re.findall(r"(\w+): '", bind)) | set(re.findall(r"set: \{ (\w+)", PANEL))


def test_every_setting_dream_control_changes_the_panel_changes_too():
    theirs, ours = remote_settings(), panel_settings()
    assert {"prompt", "strength", "master", "move_mode", "clutch", "dance_set", "running", "backend", "music"} <= theirs   # it reads them all
    assert theirs <= ours, f"settings only Dream Control changes: {sorted(theirs - ours)}"
    assert theirs <= set(settings.SETTINGS), sorted(theirs - set(settings.SETTINGS))


def test_every_command_and_message_dream_control_sends_the_panel_has():
    cmds = set(re.findall(r"cmd: '(\w+)'", REMOTE))
    assert {"next", "make", "blackout", "dance_rec"} <= cmds and "dance_fb" not in cmds   # #265: no 👍/👎 on the phone
    assert set(PHONE_ONLY_CMDS) <= cmds
    for c in sorted(cmds - set(PHONE_ONLY_CMDS)):
        assert c in CMD_IN_PANEL, f"the command {c!r} of Dream Control has no control in the panel"
        el = CMD_IN_PANEL[c]
        assert el in ids(PANEL) and wired(el), (c, el)
    msgs = set(re.findall(r"send\(\{ (\w+)", REMOTE)) - {"cmd", "set"}
    ours = set(re.findall(r"sendCtl\(\{ (\w+)", PANEL))
    assert set(PHONE_ONLY_MSGS) <= msgs
    assert msgs - set(PHONE_ONLY_MSGS) <= ours, f"messages only Dream Control sends: {sorted(msgs - set(PHONE_ONLY_MSGS) - ours)}"
    for part in SHARED_PARTS:                       # what a shared part sends, both pages send
        assert part in REMOTE and part in PANEL, part


LISTS = [("miditarget", "miditarget"), ("devtarget", "senstarget"), ("devimpulse", "sensimpulse"), ("playlist", "playlist"),
         ("music_pattern", "music_pattern"), ("beat_snap", "beat_snap"), ("model", "model"), ("quality", "quality"),
         ("size", "size"), ("aspect", "aspect"), ("cam_device", "cam_device"), ("move_mode", "move_mode"),
         ("dance_set", "dance_set")]


@pytest.mark.parametrize("remote_id,panel_id", LISTS)
def test_every_choice_of_a_list_is_in_the_panel(remote_id, panel_id):
    theirs, ours = options(REMOTE, remote_id), options(PANEL, panel_id)
    assert set(theirs) <= set(ours), set(theirs) - set(ours)


def test_every_choice_of_a_row_of_buttons_is_in_the_panel():
    assert set(seg(REMOTE, "modes", "m")) | {"flow"} <= set(seg(PANEL, "modes", "m"))
    assert set(seg(REMOTE, "musics", "v")) <= set(options(PANEL, "music"))
    assert set(seg(REMOTE, "backends", "b")) <= set(seg(PANEL, "backends", "b"))
    assert set(seg(REMOTE, "trancefreq", "v")) <= set(options(PANEL, "trancefreqm"))
    # every select Dream Control has, under its own name, is one of the checked lists or a phone's own
    selects = set(re.findall(r'<select[^>]*\bid="([\w-]+)"', REMOTE))
    checked = {r for r, _ in LISTS}
    assert selects - checked <= {"devfacing", "gpu"}, selects - checked - {"devfacing", "gpu"}
    assert "fillGpus(" in REMOTE and "fillGpus(" in PANEL          # the cloud GPUs on offer: one list, both pages


def section(html: str, start: str, end: str) -> str:
    i = html.index(start)
    return html[i:html.index(end, i)]


def test_master_brightness_and_blackout_sit_in_the_output_card():
    out = section(PANEL, '<details class="sec" data-sec="out">', "</details>")
    control = section(PANEL, '<details class="sec" data-sec="control">', "</details>")
    assert 'id="master"' in out and 'id="blackout"' in out and '<label for="master">Master brightness' in out
    assert 'id="master"' not in control and "master" not in control.split("</summary>")[0].lower()
    assert "master brightness" in out.split("</summary>")[0].lower()           # findable: the card's title names it
    assert 'aria-pressed="false"' in out[out.index('id="blackout"') - 80:]
    with open(os.path.join(STATIC, "i18n", "de.json"), encoding="utf-8") as f:
        de = json.load(f)
    assert de["Master brightness"] == "Master-Helligkeit"
    # Dream Control at the same place: its card "Output" holds both; MIDI keeps only the controller
    rout = section(REMOTE, 'data-sec="output"', "</section>")
    assert 'id="master"' in rout and 'id="black"' in rout and 'id="syphon"' in rout
    assert 'id="master"' not in section(REMOTE, 'data-sec="midi"', "</section>")
    # the MIDI mapping stays: the master fader and the blackout button are still targets
    for page in (PANEL, REMOTE):
        assert '<option value="master">Master brightness</option>' in page and '<option value="blackout">' in page


def test_reset_brings_the_master_home_to_full():
    assert settings.RESET["master"] == 1.0 == settings.SETTINGS["master"].default


# ---------- the server: Blackout is one command, whoever presses it ----------
@pytest.mark.parametrize("role,may", [("local", True), ("control", True), ("guest", False)])
def test_blackout_goes_to_black_and_back(server, saved_state, role, may):
    server.hub.state["master"] = 0.7
    server.hub.live.pop("master_before", None)
    path = ws_url(server, "/ctl", role) + ("?role=stage" if role == "local" else "")
    with client(server, role).websocket_connect(path) as ws:
        ws.receive_json()
        ws.send_text(json.dumps({"cmd": "blackout"}))
        ws.send_text(json.dumps({"set": {"prompt": "after the blackout"}}))   # a marker both a guest and Control may send
        wait_until(lambda: server.hub.state["prompt"] == "after the blackout")
        assert server.hub.state["master"] == (0.0 if may else 0.7)
        if may:
            ws.send_text(json.dumps({"cmd": "blackout"}))
            wait_until(lambda: server.hub.state["master"] == 0.7)          # back to what it was, not to full


def test_blackout_from_dark_comes_back_full(server, saved_state):
    server.hub.state["master"] = 0.0
    server.hub.live.pop("master_before", None)
    asyncio.run(server.hub.blackout())
    assert server.hub.state["master"] == 1.0
