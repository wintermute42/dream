"""The one web application every part hangs its routes on (`from web import app`); server.py puts the parts together.
Nothing else lives here, so a part can be loaded without the others."""
from fastapi import FastAPI

import i18n

app = FastAPI()


@app.middleware("http")
async def _language(request, call_next):
    """#132: answers (errors, cloud messages) in the language of the page that asks (its cookie)."""
    token = i18n.current.set(i18n.from_cookie(request.cookies.get("dream-lang")))
    try:
        return await call_next(request)
    finally:
        i18n.current.reset(token)
