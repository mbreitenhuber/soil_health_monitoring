import os
import random

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Dragon API")

cors_origins = os.getenv("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/dragons")
def get_dragons():
    return {"n": random.randint(2, 20)}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
