"""Where Dream keeps its files – read in this one place (#186), so another folder (a second installation, the tests)
is one environment variable away. Empty or unset means the default, as in the shell scripts (`${VAR:-default}`):

  DREAM_STATE_DIR   ~/.local/state/dream   settings, keys, certificates, uploaded media (never in the repository)
  DREAM_CONFIG_DIR  ~/.config/dream        the owner's own files: dream.env, playlists, MIDI/sensor/motion mappings
  DREAM_SAVE_DIR    ~/Pictures/Dream       pictures and clips kept for good from the gallery
"""
import os


def _folder(var: str, default: str) -> str:
    return os.path.expanduser(os.environ.get(var) or default)


def state_dir() -> str:
    return _folder("DREAM_STATE_DIR", "~/.local/state/dream")


def config_dir() -> str:
    return _folder("DREAM_CONFIG_DIR", "~/.config/dream")


def save_dir() -> str:
    return _folder("DREAM_SAVE_DIR", "~/Pictures/Dream")


def shown(path: str) -> str:
    """A path as a page shows it: the home folder as "~"."""
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path == home or path.startswith(home + os.sep) else path
