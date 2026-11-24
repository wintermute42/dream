"""The movement card (#250): one card in the panel instead of three, and Dream Control offers nothing of movement the
panel does not have (the panel on the Mac is the main control)."""
import os
import re

import settings

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")


def read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def section(html: str, sec: str, tag: str) -> str:
    start = html.index(f'data-sec="{sec}"')
    return html[start:html.index(f"\n  </{tag}>", start)]


def ids(html: str) -> set:
    return set(re.findall(r'<(?:input|select|button|textarea)[^>]*\bid="([\w-]+)"', html))


def test_one_card_holds_all_of_movement():
    panel = read("index.html")
    assert panel.count('<details class="sec" data-sec="motion"') == 1
    assert 'data-sec="dance"' not in panel and 'data-sec="touch"' not in panel       # the cards it replaces
    card = section(panel, "motion", "details")
    # what the three cards held is all in the one: the mode, the mood, the camera's settings, the table, the hands
    assert {"move_mode", "motion_sens", "move_cam", "movepage", "flow_kind", "flow_device", "flow_color", "flow_short",
            "marker_l", "marker_r", "flow_markers", "flow_fingers", "fastbtn", "calibgo", "calibreset", "flow_unproject",
            "diagon", "pose", "pose_scale", "touch_amt", "touch_mirror", "clutchbtn", "dance_set", "flowautobtn", "flow_auto"} <= ids(card)
    # the dance's own detection sits in the dance's part of the card, in sight – not folded away with the camera's
    dance_part = card[card.index('data-for="dance"'):card.index('class="movesrc"')]
    assert 'id="dance_kind"' in dance_part and 'value="hand"' in dance_part and 'value="on"' not in dance_part
    for element in ('id="movesources"', 'id="moveenergy"', 'id="dancepanel"', 'role="meter"'):
        assert element in card, element
    # the modes: every mode Dream knows, and a part of the card for each
    assert re.findall(r'<div class="movepart[^"]*" data-for="(\w+)"', card) == list(settings.MOVE_MODES)
    # the mood needs no gestures: its part has the strength, the energy and the camera switch – and nothing else to set
    mood = card[card.index('data-for="mood"'):card.index('data-for="flowtrack"')]
    assert ids(mood) == {"motion_sens", "move_cam"}


def test_no_setting_of_the_old_cards_is_left_in_a_page():
    gone = ("flowtrack", "dance", "motion", "motion_ai", "touch_paint", "touch_warp", "touch_content", "touch_impulse", "touch_light")
    for page in ("index.html", "remote.html"):
        html = read(page)
        for key in gone:
            assert f'id="{key}"' not in html, (page, key)


def test_dream_control_has_the_mode_and_the_moods_strength_and_no_pages():
    control, panel = read("remote.html"), read("index.html")
    card = control[control.index('id="movecard"'):control.index("\n  </section>", control.index('id="movecard"'))]
    assert ids(card) == {"move_mode", "motion_sens"}
    assert 'data-only="control"' in card[:60]                                   # never a guest's
    assert "movepage" not in control and "/dance" not in control and "/flowtrack" not in control
    # the panel is the main control: whatever Dream Control offers of movement, the panel offers too
    theirs = ids(section(control, "motion", "section"))
    assert theirs <= ids(panel), theirs - ids(panel)
    # the camera's and the detection's settings, "Fast", the hands' directness, "Mirror" and the pose are the panel's
    # alone (the server still takes them from the control key: only the controls are gone)
    for key in ("flow_kind", "flow_device", "fast", "touch_amt", "touch_mirror", "pose", "pose_scale"):
        assert f'id="{key}"' not in control and f"'{key}'" not in control, key
        assert f'id="{key}"' in panel or key == "fast", key
    assert 'id="fastbtn"' in panel
    # what is left of the mode: the four buttons and the one slider
    assert control.count('data-mode="') == len(settings.MOVE_MODES)
    assert '<input type="range" id="motion_sens"' in card
    # and both pages name the modes alike
    names = lambda html: re.findall(r'<button type="button" data-mode="\w+"[^>]*>([^<]+)</button>', html)   # noqa: E731
    assert names(control) == names(panel) == ["Off", "Mood", "Flowtrack", "Dream Dance"]


def test_the_strength_of_the_mood_is_a_target_a_controller_can_move():
    assert settings.SETTINGS["motion_sens"].target and settings.SETTINGS["motion_sens"].needs == "move_mode"
    for page in ("index.html", "remote.html"):
        assert '<option value="motion_sens">Mood: strength</option>' in read(page), page


def test_the_pages_of_the_modes_are_this_macs_and_extra_views():
    """#251, #252: Dream Dance and Flowtrack have a page each – local only, opened from the panel, reading the stage
    and never Dream itself; what steers the show is in the panel too."""
    import rights
    assert ("GET", r"/dance") in rights.LOCAL_ONLY and ("GET", r"/flowtrack") in rights.LOCAL_ONLY
    assert rights.needs("GET", "/dance") == rights.needs("GET", "/flowtrack") == rights.roles_with("stage") == {"local"}
    panel, control = read("index.html"), read("remote.html")
    for page, name in (("dance.html", "dance"), ("flowtrack.html", "flowtrack")):
        html = read(page)
        assert f"MovePage.link('{name}'" in html and f"window.open('/{name}'" in panel
        assert not re.search(r"new WebSocket|fetch\(|XMLHttpRequest|getUserMedia", html), page
        assert f"/{name}" not in control.replace("/static/", "")              # Dream Control has no pages
    card = section(panel, "motion", "details")
    for essential in ("clutchbtn", "dance_set", "flowautobtn", "flowwhy"):      # the essentials are in the panel
        assert f'id="{essential}"' in card, essential
