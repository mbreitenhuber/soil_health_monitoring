"""
main.py — AgroScan Backend
FastAPI + Jinja2: Seiten werden serverseitig gerendert.

╔══════════════════════════════════════════════════════╗
║  NEUE SEITE HINZUFÜGEN — nur 3 Schritte:             ║
║  1. NAV_PAGES: Eintrag ergänzen                      ║
║  2. Route mit @app.get("/pfad") anlegen              ║
║  3. templates/pages/_template.html kopieren          ║
║     → templates/pages/meinname.html                 ║
╚══════════════════════════════════════════════════════╝
"""

from datetime import datetime
from pathlib import Path
from typing import List
import os
import subprocess
import sys
import tempfile


from fastapi import FastAPI, Request, Cookie, HTTPException
import sqlite3
import json
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import numpy as np
import random
import math

import pandas as pd
from shapely.geometry import Point, Polygon
from pyproj import CRS, Transformer#
from dotenv import load_dotenv

load_dotenv()

# ── Pfade ──────────────────────────────────────────────
ROOT         = Path(__file__).parent.parent          # → Nebula/
TEMPLATE_DIR = ROOT / "frontend" / "templates"
STATIC_DIR   = ROOT / "frontend" / "static"
PROJECT_ROOT  = ROOT  # Fixed: was ROOT.parent, now ROOT (the Nebula directory)

DB_PATH = ROOT / "backend" / "agroscan.db"  # Also fixed: database should be in backend/

PIPELINE_SCRIPT = PROJECT_ROOT / "AgroLens" / "nutrients_predictor" / "run_pipeline_from_gps.py"
PIPELINE_WORK_DIR = PROJECT_ROOT / "data" / "pipeline_runs"
DEFAULT_MODEL_CONFIG = "Model_A"
DEFAULT_TARGET = "OC"

REQUIRED_SATELLITE_ENV_VARS = [
    "SENTINEL_DIR",
    "TMP_DIR",
    "COPERNICUS_USER",
    "COPERNICUS_PASSWORD",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
]


def _default_model_path(model_config: str = DEFAULT_MODEL_CONFIG, target: str = DEFAULT_TARGET) -> Path:
    return Path(
        os.environ.get(
            "AGROSCAN_MODEL_PATH",
            PROJECT_ROOT / "data" / "models" / model_config / "nn" / f"{model_config}_nn_{target}.pth",
        )
    )

def _missing_satellite_env_vars(env: dict[str, str]) -> list[str]:
    return [name for name in REQUIRED_SATELLITE_ENV_VARS if not env.get(name)]
# Anhängen an CSS-URLs (?v=…), damit Browser nach Style-Änderungen nicht alte Dateien aus dem Cache laden.
STATIC_CSS_VERSION = "3"

DB_PATH = ROOT / "agroscan.db"

# ── App ────────────────────────────────────────────────
app = FastAPI(title="AgroScan")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Tabelle erstellen
    c.execute("""
    CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        date TEXT,
        crop TEXT,

        field_name TEXT,
        notes TEXT,
        location_name TEXT,

        polygon TEXT,

        avg_value REAL,
        min_value REAL,
        max_value REAL,

        zones TEXT,

        created_at TEXT
    )
    """)

    # Fehlende Spalten ergänzen (für bestehende DB)
    existing_columns = [
        row[1]
        for row in c.execute("PRAGMA table_info(analyses)")
    ]

    if "field_name" not in existing_columns:
        c.execute("ALTER TABLE analyses ADD COLUMN field_name TEXT")

    if "notes" not in existing_columns:
        c.execute("ALTER TABLE analyses ADD COLUMN notes TEXT")

    if "location_name" not in existing_columns:
        c.execute("ALTER TABLE analyses ADD COLUMN location_name TEXT")

    if "created_at" not in existing_columns:
        c.execute("ALTER TABLE analyses ADD COLUMN created_at TEXT")

    conn.commit()
    conn.close()

init_db()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATE_DIR)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════
# SEITEN-DATEN — alles zentral hier, kein HTML anfassen
# ══════════════════════════════════════════════════════

# Neue Seite: Eintrag hier ergänzen + Route unten anlegen
NAV_PAGES = [
    {"id": "home",               "label": {"en": "Home",               "de": "Home"},               "href": "/",                   "group": "main"},
    {"id": "analysis",           "label": {"en": "Analysis",           "de": "Analyse"},             "href": "/analyse",            "group": "main"},
    {"id": "how_to",             "label": {"en": "How to use",         "de": "Anleitung"},           "href": "/how_to",             "group": "main"},
    {"id": "users_experience",   "label": {"en": "Users Experience",   "de": "Nutzererfahrungen"},   "href": "/users_experience",   "group": "more"},
    {"id": "report",             "label": {"en": "Report",             "de": "Bericht"},             "href": "/report",             "group": "more"},
    {"id": "future_work",        "label": {"en": "Future Work",        "de": "Zukünftige Arbeiten"}, "href": "/future_work",        "group": "middle"},
    {"id": "pers_dash",          "label": {"en": "Personal Dashboard", "de": "Mein Dashboard"},      "href": "/personal_dashboard", "group": "right"},
]

HOME_STATS = [
    {"value": "60m×60m", "label": {"en": "Minimum field size", "de": "Minimale Feldgrösse"}},
    {"value": "5 days",  "label": {"en": "Data freshness", "de": "Datenaktualität"}},
    {"value": "DE",  "label": {"en": "German-Focused", "de": "auf Deutschland fokussiert"}},
    {"value": "Sentinel-2",  "label": {"en": "by ESA", "de": "von ESA gestellt"}},
]

HOME_FEATURES = [
    {"icon": "✏️", "name": {"en": "Polygon Drawing", "de": "Polygon-Zeichnung"},
     "desc": {"en": "Draw arbitrarily shaped areas directly on the map — no CAD software needed.", "de": "Zeichne beliebig geformte Flächen direkt auf der Karte — keine CAD-Software nötig."}},
    {"icon": "🧠", "name": {"en": "ML Zone Map", "de": "ML-Zonenkarte"},
     "desc": {"en": "The backend divides your area into cells of 60m x 60m and provides a prediction value (0–1) for each zone.", "de": "Das Backend teilt deine Fläche in Zellen von 60m x 60m auf und liefert für jede Zone einen Vorhersagewert (0–1)."}},
    {"icon": "🎨", "name": {"en": "Color-Coded Map", "de": "Farbkodierte Karte"},
     "desc": {"en": "Green = high quality, yellow = medium, red = low — clearly recognizable at a glance.", "de": "Grün = hohe Qualität, Gelb = mittel, Rot = niedrig — auf einen Blick erkennbar."}},
    #{"icon": "🔌", "name": {"en": "Custom Model", "de": "Eigenes Modell"},
    # "desc": {"en": "Replace run_model() in the backend with your scikit-learn / PyTorch model.", "de": "Ersetze run_model() im Backend mit deinem scikit-learn / PyTorch Modell."}},
    #{"icon": "☁️", "name": {"en": "Cloud-Ready", "de": "Cloud-bereit"},
    # "desc": {"en": "Backend on Render, Frontend on Netlify — free, live in under 10 minutes.", "de": "Backend auf Render, Frontend auf Netlify — kostenlos, in unter 10 Minuten live."}}, 
    {"icon": "🇩🇪", "name": {"en": "German-Focused", "de": "Deutschland-fokussiert"},
     "desc": {"en": "Launches directly with a focus on the entire Germany but usable worldwide.", "de": "Startet direkt mit Blick auf die ganze Deutschland aber ist weltweit nutzbar."}},
]

ROADMAP = [
    {"version": "v0.1", "title": {"en": "Ml-Model programming and training", "de": "Ml-Modell-Programmierung und -Training"}, "done": True,
     "desc": {"en": "Literature research, programming and training of the Ml-model.", "de": "Literaturrecherche, Programmierung und Training des Ml-Modells."}},
    {"version": "v0.2", "title": {"en": "Starting Web-App development", "de": "Start der Web-App-Entwicklung"},    "done": True,
     "desc": {"en": "Web-App development with FastAPI and Jinja2. Focused on analysis and saving the results.", "de": "Web-App-Entwicklung mit FastAPI und Jinja2. Fokussiert auf Analyse und Speichern der Ergebnisse."}},
    {"version": "v0.3", "title": {"en": "Integration of the Ml-model into the Web-App", "de": "Integration des Ml-Modells in die Web-App"},   "done": False,
     "desc": {"en": "Connect the Web-App to the Ml-Model and make it usable.", "de": "Verbinde die Web-App mit dem Ml-Modell und macht es nutzbar."}},
    {"version": "v0.4", "title": {"en": "Finalizing the Web-App", "de": "Finalizing the Web-App"},   "done": False,
     "desc": {"en": "Finalizing the Web-App. Focused on the user experience and the design.", "de": "Die Web-App wird finalisiert. Fokussiert auf die Nutzungserfahrung und das Design."}},
    {"version": "v1.0", "title": {"en": "Finishing the Project", "de": "Projekt beenden"},"done": False,
     "desc": {"en": "Final deployment and documentation of the project.", "de": "Finales Deployment und die Dokumentation des Projekts."}},
     {"version": "v1.1", "title": {"en": "The Presentation", "de": "Die Präsentation"},"done": False,
     "desc": {"en": "Final presentation of the project.", "de": "Finale Präsentation des Projekts."}},
]

# Neue Teammitglieder: Eintrag hier ergänzen.
# photo: Dateiname in static/assets/team/ — oder None für Platzhalter
TEAM_MEMBERS = [
    {"name": "Dein Name",   "role": "ML Engineer",   "photo": None,
     "bio": "Kurze Bio — Spezialgebiet, Uni, Erfahrung mit Agrardaten."},
    {"name": "Teamkollege", "role": "Backend / GIS",  "photo": None,
     "bio": "FastAPI, PostGIS, Geodatenverarbeitung."},
    {"name": "Teamkollege", "role": "Frontend / UX",  "photo": None,
     "bio": "Karten-UX, Leaflet, agrarische Nutzerforschung."},
     {"name": "Teamkollege", "role": "Frontend / UX",  "photo": None,
     "bio": "Karten-UX, Leaflet, agrarische Nutzerforschung."},
]


# ── Hilfsfunktion: Basis-Kontext für jede Seite ────────
def ctx(request: Request, page_id: str, lang: str = "en", **extra) -> dict:
    """lang direkt hier verarbeiten — get_nav_context() wird überflüssig."""
    if lang not in ("en", "de"):
        lang = "en"

    translated_pages = [
        {**p, "label": p["label"][lang]}
        for p in NAV_PAGES
    ]

    return {
        "request":       request,
        "nav_pages":     translated_pages,   # ← direkt übersetzt
        "current_page":  page_id,
        "current_year":  datetime.now().year,
        "api_url":       "http://localhost:8000",
        "lang":          lang,
        "static_css_version": STATIC_CSS_VERSION,
        # analysis.html erwartet `leaflet_translations` (wird im JS geparst)
        "leaflet_translations": LEAFLET_DRAW_TRANSLATIONS.get(lang, {}),
        **extra,
    }

# ══════════════════════════════════════════════════════
# Spracheinstellung über Cookie und Nav-Label-Auswahl
# ══════════════════════════════════════════════════════

LEAFLET_DRAW_TRANSLATIONS = {
    "en": {
        "draw_polygon": "Draw a polygon",
        "draw_rectangle": "Draw a rectangle", 
        "draw_polyline": "Draw a polyline",
        "draw_circle": "Draw a circle",
        "draw_marker": "Add a marker",
        "edit_layers": "Edit layers",
        "delete_layers": "Delete layers",
        "cancel": "Cancel",
        "finish": "Finish",
        "undo": "Undo last point",
        "save": "Save changes",
        "clear_all": "Delete all"
    },
    "de": {
        "draw_polygon": "Polygon zeichnen",
        "draw_rectangle": "Rechteck zeichnen",
        "draw_polyline": "Linie zeichnen", 
        "draw_circle": "Kreis zeichnen",
        "draw_marker": "Marker setzen",
        "edit_layers": "Layer bearbeiten",
        "delete_layers": "Layer entfernen",
        "cancel": "Abbrechen",
        "finish": "Beenden",
        "undo": "Rückgängig",
        "save": "Speichern",
        "clear_all": "Alle entfernen"
    }
}

def get_nav_context(current_page: str, lang: str = "en"):
    """Gibt nav_pages mit übersetzten Labels zurück."""
    # Sprache validieren
    if lang not in LEAFLET_DRAW_TRANSLATIONS:
        lang = "en"
    
    pages = [
        {**p, "label": p["label"][lang]}
        for p in NAV_PAGES
    ]
    return {
        "nav_pages": pages, 
        "current_page": current_page, 
        "lang": lang,
        "leaflet_translations": LEAFLET_DRAW_TRANSLATIONS[lang]
    }

# Sprache aus Cookie lesen
@app.get("/set-lang/{lang}")
def set_language(lang: str, request: Request):
    redirect_url = request.headers.get("Referer", "/")
    response = RedirectResponse(url=redirect_url)
    response.set_cookie("lang", lang, max_age=60*60*24*365)
    return response

# ══════════════════════════════════════════════════════
# HTML-ROUTEN
# ══════════════════════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
async def home(request: Request, lang: str = Cookie(default="en")):
    hero_image = "Hauptbild.png"
    hero_image_version = None
    try:
        hero_path = STATIC_DIR / "assets" / "image" / hero_image
        hero_image_version = int(hero_path.stat().st_mtime)
    except FileNotFoundError:
        hero_image_version = None

    return templates.TemplateResponse("pages/index.html", ctx(
        request, "home", lang,
        stats=HOME_STATS,
        features=HOME_FEATURES,
        hero_image=hero_image,
        hero_image_version=hero_image_version,
        roadmap=ROADMAP,
        team=TEAM_MEMBERS,
    ))

@app.get("/analyse", response_class=HTMLResponse)
async def analysis(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/analysis.html", ctx(
        request, "analysis", lang,
    ))

@app.get("/future_work", response_class=HTMLResponse)
async def future_work(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/future_work.html", ctx(
        request, "future_work", lang,
        roadmap=ROADMAP,
        team=TEAM_MEMBERS,
        gallery_images=None,     # z.B. [{"file": "field.jpg", "alt": "Feld"}]
    ))

@app.get("/how_to", response_class=HTMLResponse)
async def how_to(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/how_to.html", ctx(
        request, "how_to", lang,
        # seitenspezifische Daten hier:
        # my_data=MY_DATA,
    ))


@app.get("/personal_dashboard", response_class=HTMLResponse)
async def pers_dash(request: Request, lang: str = Cookie(default="en")):

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT * FROM analyses ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()

    analyses = []
    for r in rows:
        analyses.append({
            "id": r["id"],
            "date": r["date"],
            "crop": r["crop"],
            "field_name": r["field_name"],
            "notes": r["notes"],
            "location_name": r["location_name"],
            "polygon": json.loads(r["polygon"]) if r["polygon"] else [],
            "avg_value": r["avg_value"] or 0,
            "min_value": r["min_value"] or 0,
            "max_value": r["max_value"] or 0,
            "zones": json.loads(r["zones"]) if r["zones"] else [],
            "created_at": r["created_at"],
        })

    return templates.TemplateResponse("pages/pers_dash.html", ctx(
        request, "pers_dash", lang,
        analyses=analyses
    ))

@app.get("/report", response_class=HTMLResponse)
async def report(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/report.html", ctx(
        request, "report", lang,
        # seitenspezifische Daten hier:
        # my_data=MY_DATA,
    ))

@app.get("/users_experience", response_class=HTMLResponse)
async def users_experience(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/users_experience.html", ctx(
        request, "users_experience", lang,
        # seitenspezifische Daten hier:
        # my_data=MY_DATA,
    ))

# Neue Route — Vorlage:
# @app.get("/kontakt", response_class=HTMLResponse)
# async def kontakt(request: Request):
#     return templates.TemplateResponse("pages/kontakt.html", ctx(
#         request, "kontakt",
#         # seitenspezifische Daten hier:
#         # my_data=MY_DATA,
#     ))


# ══════════════════════════════════════════════════════
# API-ENDPUNKTE (JSON)
# ══════════════════════════════════════════════════════

class Coordinate(BaseModel):
    lat: float
    lng: float

class FieldRequest(BaseModel):
    polygon: List[Coordinate]
    analysis_date: str | None = None  # comes from frontend date input (YYYY-MM-DD)

class ZoneResult(BaseModel):
    sub_polygon: List[Coordinate]
    value: float
    label: str

class PredictionResponse(BaseModel):
    zones:     List[ZoneResult]
    unit:      str
    min_value: float
    max_value: float

class SaveRequest(BaseModel):
    date: str

    crop: str | None = None
    field_name: str | None = None
    notes: str | None = None
    location_name: str | None = None

    polygon: List[Coordinate]

    avg_value: float
    min_value: float
    max_value: float

    zones: list


def _pick_utm_epsg(lat: float, lng: float) -> int:
    """
    Pick a UTM CRS EPSG based on lat/lng.
    North hemisphere: EPSG:326xx, South hemisphere: EPSG:327xx.
    """
    zone = int(math.floor((lng + 180) / 6) + 1)
    if lat >= 0:
        return 32600 + zone
    return 32700 + zone


def _polygon_centroid_latlng(polygon: List[Coordinate]) -> Coordinate:
    # simple mean centroid is good enough for picking UTM zone
    return Coordinate(
        lat=float(np.mean([p.lat for p in polygon])),
        lng=float(np.mean([p.lng for p in polygon])),
    )


def _transformer(src_epsg: int, dst_epsg: int) -> Transformer:
    return Transformer.from_crs(CRS.from_epsg(src_epsg), CRS.from_epsg(dst_epsg), always_xy=True)


def _polygon_to_utm_polygon(polygon_latlng: List[Coordinate], utm_epsg: int) -> Polygon:
    t = _transformer(4326, utm_epsg)
    xy = [t.transform(p.lng, p.lat) for p in polygon_latlng]  # (x, y) meters
    poly = Polygon(xy)
    if not poly.is_valid:
        # best-effort fix for self intersections, etc.
        poly = poly.buffer(0)
    return poly


def _grid_center_points_in_polygon(
    polygon_latlng: List[Coordinate],
    cell_size_m: float = 60.0,
    include_border: bool = True,
):
    """
    Returns:
      - utm_epsg used
      - list of points: dicts with row/col, center x/y in meters, and lat/lng
    """
    centroid = _polygon_centroid_latlng(polygon_latlng)
    utm_epsg = _pick_utm_epsg(centroid.lat, centroid.lng)

    poly_m = _polygon_to_utm_polygon(polygon_latlng, utm_epsg)
    minx, miny, maxx, maxy = poly_m.bounds

    half = cell_size_m / 2.0
    nx = int(math.ceil((maxx - minx) / cell_size_m))
    ny = int(math.ceil((maxy - miny) / cell_size_m))

    t_back = _transformer(utm_epsg, 4326)

    points = []
    for r in range(ny):
        y = miny + half + r * cell_size_m
        for c in range(nx):
            x = minx + half + c * cell_size_m
            pt = Point(x, y)
            inside = poly_m.covers(pt) if include_border else poly_m.contains(pt)
            if not inside:
                continue

            lng, lat = t_back.transform(x, y)
            points.append(
                {
                    "row": r,
                    "col": c,
                    "center_x_m": float(x),
                    "center_y_m": float(y),
                    "center_lat": float(lat),
                    "center_lng": float(lng),
                }
            )

    return utm_epsg, points


def _cell_polygon_latlng_from_center(
    *,
    center_x_m: float,
    center_y_m: float,
    cell_size_m: float,
    utm_epsg: int,
) -> List[Coordinate]:
    """
    Build the 60m×60m cell polygon corners around a center point.
    Returned as lat/lng (EPSG:4326) for the frontend map.
    """
    half = cell_size_m / 2.0
    corners_m = [
        (center_x_m - half, center_y_m - half),
        (center_x_m + half, center_y_m - half),
        (center_x_m + half, center_y_m + half),
        (center_x_m - half, center_y_m + half),
    ]
    t_back = _transformer(utm_epsg, 4326)
    coords = []
    for x, y in corners_m:
        lng, lat = t_back.transform(x, y)
        coords.append(Coordinate(lat=float(lat), lng=float(lng)))
    return coords


def get_field_elevation_m(center_lat: float, center_lng: float) -> float | None:
    """
    Placeholder hook:
      - Option 1: call a DEM / elevation API
      - Option 2: sample from a local raster (rasterio)
    """
    return None

def _build_gps_input_csv(grid_csv: pd.DataFrame, analysis_date: str, work_dir: Path) -> Path:
    gps_input = work_dir / "gps_input.csv"
    gps_input_df = pd.DataFrame(
        {
            "POINTID": [f"pt_{index + 1}" for index in range(len(grid_csv))],
            "SURVEY_DATE": analysis_date,
            "TH_LAT": grid_csv["center_lat"].astype(float).to_list(),
            "TH_LONG": grid_csv["center_lng"].astype(float).to_list(),
        }
    )
    gps_input_df.to_csv(gps_input, index=False)
    return gps_input

def run_model(
        grid_csv: pd.DataFrame,
        analysis_date: str | None = None,
        model_config: str = DEFAULT_MODEL_CONFIG,
        target: str = DEFAULT_TARGET,
) -> np.ndarray:
    """
    Runs the full GPS -> Sentinel -> feature -> NN pipeline and returns the
    prediction values for the frontend.
    """
    if grid_csv.empty:
        print("[backend] run_model: received empty grid, skipping pipeline", flush=True)
        return np.array([], dtype=float)

    survey_date = analysis_date or datetime.now().strftime("%Y-%m-%d")
    PIPELINE_WORK_DIR.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="pipeline_", dir=str(PIPELINE_WORK_DIR)))
    print(
        f"[backend] run_model: starting pipeline for {len(grid_csv)} cells "
        f"(date={survey_date}, model_config={model_config}, target={target})",
        flush=True,
    )

    gps_input = _build_gps_input_csv(grid_csv, survey_date, run_dir)
    predictions_output = run_dir / "predictions.csv"
    model_path = _default_model_path(model_config, target)

    print(f"[backend] run_model: wrote GPS input to {gps_input}", flush=True)
    print(f"[backend] run_model: using model file {model_path}", flush=True)
    print(f"[backend] run_model: pipeline output will be read from {predictions_output}", flush=True)

    env = os.environ.copy()
    env["DATASET_PATH"] = str(PROJECT_ROOT / "data" / "datasets")

    missing_env_vars = _missing_satellite_env_vars(env)
    if missing_env_vars:
        print(
            "[backend] run_model: missing satellite environment variables: "
            + ", ".join(missing_env_vars),
            flush=True,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Satellite pipeline cannot start because required environment variables are missing: "
                + ", ".join(missing_env_vars)
            ),
        )

    cmd = [
        sys.executable,
        str(PIPELINE_SCRIPT),
        "--gps",
        str(gps_input),
        "--output",
        str(predictions_output),
        "--model-config",
        model_config,
        "--target",
        target,
        "--shape",
        "9x9",
        "--flatten",
        "--normalize",
        "--model",
        str(model_path),
    ]
    print(f"[backend] run_model: launching pipeline script {PIPELINE_SCRIPT}", flush=True)
    subprocess.run(cmd, check=True, env=env)
    print("[backend] run_model: pipeline finished, reading predictions CSV", flush=True)

    predictions_df = pd.read_csv(predictions_output)
    prediction_column = f"{target}_pred"
    if prediction_column not in predictions_df.columns:
        raise ValueError(f"Prediction output missing column '{prediction_column}': {predictions_output}")
    print(
        f"[backend] run_model: loaded {len(predictions_df)} rows from predictions CSV "
        f"(column={prediction_column})",
        flush=True,
    )

    return predictions_df[prediction_column].to_numpy(dtype=float)


def value_to_label(value: float) -> str: # TODO: adjust with relevant OC content thresholds
    if value >= 0.66: return "Hoch"
    if value >= 0.33: return "Mittel"
    return "Niedrig"


@app.get("/api/health")
def health():
    return {"status": "AgroScan API läuft ✅"}


@app.get("/healthz")
def healthz():
    """Used by Kubernetes/Helm probes (see helm/values.yaml components.backend.health)."""
    return {"status": "ok"}


@app.post("/api/predict", response_model=PredictionResponse)
def predict(request: FieldRequest):
    print(
        f"[backend] /api/predict: received request with {len(request.polygon)} polygon points "
        f"and analysis_date={request.analysis_date}",
        flush=True,
    )
    # 1) Build 60m grid centers (this is your "CSV" table)
    utm_epsg, grid_points = _grid_center_points_in_polygon(
        request.polygon,
        cell_size_m=60.0,
        include_border=True,
    )
    print(
        f"[backend] /api/predict: generated {len(grid_points)} grid cells using UTM EPSG {utm_epsg}",
        flush=True,
    )


    # 2) Field elevation hook (single value for whole field)
    centroid = _polygon_centroid_latlng(request.polygon)
    field_elevation_m = get_field_elevation_m(centroid.lat, centroid.lng)

    # 3) Build the in-memory CSV rows
    # Note: you can later add more columns here (satellite features, slope, soil grids, etc.)
    rows = []
    for p in grid_points:
        rows.append(
            {
                "center_lat": p["center_lat"],
                "center_lng": p["center_lng"],
                "analysis_date": request.analysis_date,
                "field_elevation_m": field_elevation_m,
                "row": p["row"],
                "col": p["col"],
            }
        )
    grid_csv = pd.DataFrame(rows)

    # 4) Model inference (returns one value per 60m cell center)
    print("[backend] /api/predict: calling run_model", flush=True)
    y = run_model(grid_csv, analysis_date=request.analysis_date)

    # 5) Convert predictions into polygons for the frontend (each cell as a zone)
    zones = []
    for p, value in zip(grid_points, y):
        cell_poly = _cell_polygon_latlng_from_center(
            center_x_m=p["center_x_m"],
            center_y_m=p["center_y_m"],
            cell_size_m=60.0,
            utm_epsg=utm_epsg,
        )
        zones.append(
            ZoneResult(
                sub_polygon=cell_poly,
                value=round(float(value), 3),
                label=value_to_label(float(value)),
            )
        )
    print(f"[backend] /api/predict: created {len(zones)} prediction zones", flush=True)

    return PredictionResponse(
        zones=zones,
        unit="Bodenqualität",
        min_value=0.0,
        max_value=1.0,
    )


@app.post("/api/save-analysis")
def save_analysis(req: SaveRequest):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        INSERT INTO analyses (
            date,
            crop,
            field_name,
            notes,
            location_name,
            polygon,
            avg_value,
            min_value,
            max_value,
            zones,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        req.date,
        req.crop,
        req.field_name,
        req.notes,
        req.location_name,

        json.dumps([p.dict() for p in req.polygon]),

        req.avg_value,
        req.min_value,
        req.max_value,

        json.dumps(req.zones),

        datetime.now().isoformat()
    ))

    conn.commit()
    conn.close()

    return {"status": "saved"}

@app.get("/api/analyses")
def get_analyses():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("SELECT * FROM analyses ORDER BY id DESC")
    rows = c.fetchall()

    conn.close()

    return [
        {
            "id": r[0],
            "date": r[1],
            "crop": r[2],
            "field_name": r[3],
            "notes": r[4],
            "location_name": r[5],

            "polygon": json.loads(r[6]),

            "avg_value": r[7],
            "min_value": r[8],
            "max_value": r[9],

            "zones": json.loads(r[10]),

            "created_at": r[11]
        }
        for r in rows
    ]

@app.delete("/api/analyses/{id}")
def delete_analysis(id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("DELETE FROM analyses WHERE id = ?", (id,))
    conn.commit()
    conn.close()

    return {"status": "deleted"}

# ══════════════════════════════════════════════════════
# Download data function
# ══════════════════════════════════════════════════════

import csv
from io import StringIO
import json

def _analysis_to_csv(analyses: list[dict]) -> str:
    output = StringIO()
    writer = csv.writer(output, delimiter=";")

    writer.writerow([
        "ID",
        "Date",
        "Crop",
        "Field Name",
        "Location",
        "Notes",
        "Avg (%)",
        "Min (%)",
        "Max (%)",
        "Polygon Points",
        "Zones Count",
        "Created At"
    ])

    for a in analyses:

        polygon = a.get("polygon") or []
        zones = a.get("zones") or []

        # SAFE guards (verhindert Internal Server Error)
        poly_len = len(polygon) if isinstance(polygon, list) else 0
        zone_len = len(zones) if isinstance(zones, list) else 0

        writer.writerow([
            a.get("id"),
            a.get("date"),
            a.get("crop"),
            a.get("field_name"),
            a.get("location_name"),
            a.get("notes"),
            round(a.get("avg_value", 0) * 100, 1),
            round(a.get("min_value", 0) * 100, 1),
            round(a.get("max_value", 0) * 100, 1),
            poly_len,
            zone_len,
            a.get("created_at")
        ])

    output.seek(0)
    return output.getvalue()

from fastapi.responses import Response
import sqlite3
import json

@app.get("/api/analyses/{id}/csv")
def download_single_csv(id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("SELECT * FROM analyses WHERE id = ?", (id,))
    r = c.fetchone()
    conn.close()

    if not r:
        return {"error": "not found"}

    analysis = {
        "id": r[0],
        "date": r[1],
        "crop": r[2],
        "field_name": r[3],
        "notes": r[4],
        "location_name": r[5],
        "polygon": json.loads(r[6]) if r[6] else [],
        "avg_value": r[7],
        "min_value": r[8],
        "max_value": r[9],
        "zones": json.loads(r[10]) if r[10] else [],
        "created_at": r[11]
    }

    csv_data = _analysis_to_csv([analysis])

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=analysis_{id}.csv"
        }
    )

@app.get("/api/analyses/csv")
def download_all_csv():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("SELECT * FROM analyses ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()

    analyses = []
    for r in rows:
        analyses.append({
            "id": r[0],
            "date": r[1],
            "crop": r[2],
            "field_name": r[3],
            "notes": r[4],
            "location_name": r[5],
            "polygon": json.loads(r[6]) if r[6] else [],
            "avg_value": r[7],
            "min_value": r[8],
            "max_value": r[9],
            "zones": json.loads(r[10]) if r[10] else [],
            "created_at": r[11]
        })

    csv_data = _analysis_to_csv(analyses)

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=all_analyses.csv"
        }
    )

@app.put("/api/update-analysis/{id}")
def update_analysis(id: int, req: SaveRequest):

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        UPDATE analyses
        SET
            field_name = ?,
            location_name = ?,
            crop = ?,
            notes = ?
        WHERE id = ?
    """, (
        req.field_name,
        req.location_name,
        req.crop,
        req.notes,
        id
    ))

    conn.commit()
    conn.close()

    return {"status": "updated"}