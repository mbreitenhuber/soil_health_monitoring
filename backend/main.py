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

from fastapi import FastAPI, Request, Cookie
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
from pyproj import CRS, Transformer

# ── Pfade ──────────────────────────────────────────────
ROOT         = Path(__file__).parent.parent          # → agroscan/
TEMPLATE_DIR = ROOT / "frontend" / "templates"
STATIC_DIR   = ROOT / "frontend" / "static"

DB_PATH = ROOT / "agroscan.db"

# ── App ────────────────────────────────────────────────
app = FastAPI(title="AgroScan")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
    CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        polygon TEXT,
        avg_value REAL,
        min_value REAL,
        max_value REAL,
        zones TEXT,
        crop TEXT
    )
    """)

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
    {"id": "users_experience",   "label": {"en": "Users Experience",   "de": "Nutzererfahrungen"},   "href": "/users_experience",   "group": "about"},
    {"id": "about",              "label": {"en": "Research Background", "de": "Forschungshintergrund"}, "href": "/research_background",       "group": "about"},
    {"id": "report",             "label": {"en": "Report",             "de": "Bericht"},             "href": "/report",             "group": "about"},
    {"id": "pers_dash",          "label": {"en": "Personal Dashboard", "de": "Mein Dashboard"},      "href": "/personal_dashboard", "group": "right"},
]

HOME_STATS = [
    {"value": "60m×60m", "label": "Datapoint acurracy"},
    {"value": "<1s",  "label": "Analysezeit"},
    {"value": "±5%",  "label": "Modell-Rauschen"},
    {"value": "OSM",  "label": "Kartenbasis"},
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
    {"version": "v0.1", "title": "Starter-Template",  "done": True,
     "desc": "Polygon-Zeichnung, FastAPI-Backend, Zonen-Visualisierung mit Platzhalter-Modell."},
    {"version": "v0.2", "title": "ML-Integration",    "done": False,
     "desc": "Echtes Bodenqualitäts-Modell, Feature-Extraktion, Shapely-Clipping."},
    {"version": "v0.3", "title": "Satellitendaten",   "done": False,
     "desc": "Sentinel-2 NDVI-Einbindung, historische Zeitreihen, Export als GeoJSON/CSV."},
    {"version": "v1.0", "title": "Produktionsrelease","done": False,
     "desc": "Auth, Multi-Tenant, mobile-optimiert, Deutschlandisches Amt für Landwirtschaft Daten."},
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
        gallery_images=[{"file": "image/Europe.png", "alt": "European Field"}, {"file": "image/Sentinel-2.png", "alt": "Sentinel-2 Satellite Image"} ],     # z.B. [{"file": "field.jpg", "alt": "Feld"}]
    ))

@app.get("/analyse", response_class=HTMLResponse)
async def analysis(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/analysis.html", ctx(
        request, "analysis", lang,
    ))

@app.get("/research_background", response_class=HTMLResponse)
async def research_background(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/research_background.html", ctx(
        request, "research_background", lang,
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
    c = conn.cursor()
    c.execute("SELECT * FROM analyses ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()

    analyses = [
        {
            "id": r[0],
            "date": r[1],
            "polygon": json.loads(r[2]),
            "avg_value": r[3],
            "min_value": r[4],
            "max_value": r[5],
            "zones": json.loads(r[6]),
            "crop": r[7] if len(r) > 7 else None
        }
        for r in rows
    ]

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
    polygon: List[Coordinate]
    avg_value: float
    min_value: float
    max_value: float
    zones: list
    crop: str | None = None


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


def run_model(grid_csv: pd.DataFrame) -> np.ndarray:
    """
    PLATZHALTER — hier kommt dein echtes ML-Modell rein.

    WICHTIG: Wir geben dem Modell die Raster-Zellmittelpunkte als "CSV-Tabelle"
    (in-memory). D.h. `grid_csv` ist ein DataFrame, der die Spalten enthält, die
    du sonst ins CSV schreiben würdest, z.B.:

      - center_lat
      - center_lng
      - analysis_date
      - field_elevation_m
      - row, col, ...

    Beispiel (scikit-learn):
        model = joblib.load("model.joblib")
        X = grid_csv[FEATURE_COLS]              # z.B. ["center_lat", "center_lng", ...]
        y = model.predict_proba(X)[:, 1]        # oder model.predict(X)
        return y
    """
    center_lat = grid_csv["center_lat"].to_numpy(dtype=float)
    center_lng = grid_csv["center_lng"].to_numpy(dtype=float)
    value = (np.sin(center_lat * 50) + np.cos(center_lng * 50) + 2) / 4
    value += np.random.uniform(-0.05, 0.05, size=value.shape[0])
    return np.clip(value, 0, 1).astype(float)


def value_to_label(value: float) -> str:
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
    # 1) Build 60m grid centers (this is your "CSV" table)
    utm_epsg, grid_points = _grid_center_points_in_polygon(
        request.polygon,
        cell_size_m=60.0,
        include_border=True,
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
    y = run_model(grid_csv)

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
        INSERT INTO analyses (date, polygon, avg_value, min_value, max_value, zones, crop)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        req.date,
        json.dumps([p.dict() for p in req.polygon]),
        req.avg_value,
        req.min_value,
        req.max_value,
        json.dumps(req.zones),
        req.crop
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
            "polygon": json.loads(r[2]),
            "avg_value": r[3],
            "min_value": r[4],
            "max_value": r[5],
            "zones": json.loads(r[6]),
            "crop": r[7] if len(r) > 7 else None
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