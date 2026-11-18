"""What Dream is started with: its role and the environment variables of this run. Read once, at import; no folders
are made and no files read here (paths.py names the folders, rights.py holds the keys)."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROLE = os.environ.get("DREAM_ROLE", "app")          # "app" (the Mac) or "worker" (the cloud GPU: rendering only)
WHISPER = os.environ.get("DREAM_WHISPER", "mlx-community/whisper-large-v3-turbo")
OLLAMA = os.environ.get("DREAM_OLLAMA", "http://127.0.0.1:11434")
PROMPT_MODEL = os.environ.get("DREAM_PROMPT_MODEL", "llama3.2:3b")
SOURCE_URL = os.environ.get("DREAM_SOURCE_URL", "https://github.com/wintermute42/dream")   # #178: AGPL §13 – where the code is
CLOUD = os.environ.get("DREAM_CLOUD_CMD") or os.path.join(HERE, "dream-cloud")   # the override is for tests (no real cloud)

LAN = os.environ.get("DREAM_LAN") == "1"            # started with --lan: devices in the home network get in with a key
PORT = int(os.environ.get("DREAM_PORT", "7860"))
# #145: Dream Control over https. #153: never 7861 – that is the cloud GPU's SSH tunnel (dream-cloud LOCAL_PORT).
CLOUD_TUNNEL_PORT = 7861
HTTPS_PORT = int(os.environ.get("DREAM_HTTPS_PORT", "7443"))
