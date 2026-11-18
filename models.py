"""The image models Dream paints with – names and repositories only, so the settings can name them without loading
PyTorch (render.py loads and runs them)."""

# model key -> (pipeline repo, tiny decoder repo, is SDXL)
MODELS = {
    "sd-turbo": ("stabilityai/sd-turbo", "madebyollin/taesd", False),
    "sdxl-turbo": ("stabilityai/sdxl-turbo", "madebyollin/taesdxl", True),
}

# OpenPose ControlNets: the dancer's skeleton (from flowtrack /pose.jpg) shapes the figure
# ControlNets per kind: "pose" (the dancer's skeleton) and "edges" (#113: the outlines of the input picture keep the
# body and the room recognisable while the content is dreamed). Downloaded on first use.
CONTROLNETS = {
    "pose": {"sd-turbo": "thibaud/controlnet-sd21-openpose-diffusers",     # SD 2.1 family, ~0.7 GB
             "sdxl-turbo": "xinsir/controlnet-openpose-sdxl-1.0"},         # SDXL, ~2.5 GB (Apache 2.0), for the cloud
    "edges": {"sd-turbo": "thibaud/controlnet-sd21-canny-diffusers",       # ~0.7 GB
              "sdxl-turbo": "xinsir/controlnet-canny-sdxl-1.0"},           # ~2.5 GB (Apache 2.0)
}

NEED_GB = {"sd-turbo": 4.0, "sdxl-turbo": 9.0}          # memory a model needs while loading (weights + working space)
