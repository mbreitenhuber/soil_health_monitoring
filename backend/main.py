"""
main.py — AgroScan Backend
FastAPI + Jinja2: Seiten werden serverseitig gerendert.

╔══════════════════════════════════════════════════════╗
║  NEUE SEITE HINZUFÜGEN — nur 3 Schritte:             ║
║  1. NAV_PAGES: Eintrag ergänzen                      ║
║  2. Route mit @app.get("/pfad") anlegen              ║
║  3. templates/pages/_template.html kopieren          ║
║     → templates/pages/meinname.html                  ║
╚══════════════════════════════════════════════════════╝
"""

from datetime import datetime
from pathlib import Path
from typing import List
import os
import subprocess
import sys
import tempfile

from shapely.geometry import Polygon

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
from shapely.geometry import Point, Polygon, box
from pyproj import CRS, Transformer#
from dotenv import load_dotenv

from oc_classification import (
    lucas_oc_percentile_thresholds,
    oc_classification_meta,
    oc_tier,
    oc_tier_label,
)

load_dotenv()

# ── Pfade (backend root = directory containing main.py, /app in Docker) ──
PROJECT_ROOT = Path(__file__).resolve().parent
TEMPLATE_DIR = PROJECT_ROOT / "frontend" / "templates"
STATIC_DIR = PROJECT_ROOT / "frontend" / "static"
DEFAULT_GRID_CELL_SIZE_M = 60.0
DEFAULT_GRID_MATCH_RADIUS_M = 10.0


def _default_db_path() -> Path:
    override = os.environ.get("AGROSCAN_DB_PATH")
    if override:
        return Path(override)

    persistent_root = PROJECT_ROOT.parent / "persistent-data"
    return persistent_root / "agroscan.db"


DB_PATH = _default_db_path()

PIPELINE_SCRIPT = PROJECT_ROOT / "AgroScan" / "nutrients_predictor" / "run_pipeline_from_gps.py"
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
    override = os.environ.get("AGROSCAN_MODEL_PATH")
    if override:
        model_root = Path(override)
        if model_root.suffix == ".pth" and model_root.is_file():
            return model_root
        if model_root.name != "models":
            model_root = model_root / "models"
    else:
        model_root = PROJECT_ROOT / "data" / "models"

    return model_root / model_config / "nn" / f"{model_config}_nn_{target}.pth"


def _missing_satellite_env_vars(env: dict[str, str]) -> list[str]:
    return [name for name in REQUIRED_SATELLITE_ENV_VARS if not env.get(name)]


def _api_base_url() -> str:
    """Base URL for browser API calls (empty = same origin in templates/JS)."""
    return os.environ.get("AGROSCAN_API_URL", "http://localhost:8000").rstrip("/")


# Anhängen an CSS-URLs (?v=…), damit Browser nach Style-Änderungen nicht alte Dateien aus dem Cache laden.
STATIC_CSS_VERSION = "7"

import math

def _calculate_area_ha(polygon: List["Coordinate"]) -> float:
    if len(polygon) < 3:
        return 0.0

    R = 6371000  # Erdradius in Metern
    coords = [(p.lat, p.lng) for p in polygon]
    area = 0.0
    n = len(coords)

    for i in range(n):
        j = (i + 1) % n
        lat_i, lng_i = coords[i]
        lat_j, lng_j = coords[j]

        xi = math.radians(lng_i) * R * math.cos(math.radians(lat_i))
        yi = math.radians(lat_i) * R
        xj = math.radians(lng_j) * R * math.cos(math.radians(lat_j))
        yj = math.radians(lat_j) * R

        area += xi * yj - xj * yi

    return round(abs(area / 2) / 10000, 3)

# ── App ────────────────────────────────────────────────
app = FastAPI(title="AgroScan")

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
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
              
        field_area_ha REAL,

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

    if "field_area_ha" not in existing_columns:
        c.execute("ALTER TABLE analyses ADD COLUMN field_area_ha REAL")

    conn.commit()
    conn.close()


def _json_list(value) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _analysis_from_row(row: sqlite3.Row) -> dict:
    """Spaltennamen nutzen — physische Reihenfolge in älteren DBs weicht ab."""
    return {
        "id": row["id"],
        "date": row["date"],
        "crop": row["crop"],
        "field_name": row["field_name"],
        "notes": row["notes"],
        "location_name": row["location_name"],
        "polygon": _json_list(row["polygon"]),
        "avg_value": row["avg_value"] or 0,
        "min_value": row["min_value"] or 0,
        "max_value": row["max_value"] or 0,
        "zones": _json_list(row["zones"]),
        "field_area_ha": row["field_area_ha"] or 0,
        "created_at": row["created_at"],
    }


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
    {"id": "home",               "label": {"en": "Home",               "de": "Home"},                "href": "/",                   "group": "main"},
    {"id": "analysis",           "label": {"en": "Analysis",           "de": "Analyse"},             "href": "/analyse",            "group": "main"},
    {"id": "how_to",             "label": {"en": "How to use",         "de": "Anleitung"},           "href": "/how_to",             "group": "main"},
    {"id": "unser_analysis",     "label": {"en": "Who We Built AgroScan For",     "de": "Für wen wir AgroScan entwickelt haben"},        "href": "/users_analysis",     "group": "more"},
    {"id": "report",             "label": {"en": "Report",             "de": "Bericht"},             "href": "/report",             "group": "more"},
    {"id": "future_work",        "label": {"en": "Future Work",        "de": "Zukünftige Arbeiten"}, "href": "/future_work",        "group": "more"},
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
    {"version": "v0.1", "title": {"en": "Prototype development", "de": "Prototyp-Entwicklung"}, "done": True,
     "desc": {"en": "Literature research, ML model programming and training, initial web-app development with FastAPI and Jinja2, and integration of the model into the application.",
              "de": "Literaturrecherche, Programmierung und Training des ML-Modells, erste Web-App-Entwicklung mit FastAPI und Jinja2 sowie Integration des Modells in die Anwendung."}},
    {"version": "v1.0", "title": {"en": "First version for project submission", "de": "Erste Version zur Projektabgabe"}, "done": True,
     "desc": {"en": "Finalizing UX and design, deployment, project documentation, and presentation for course submission — the current AgroScan v1.0.",
              "de": "Finalisierung von UX und Design, Deployment, Projektdokumentation und Präsentation zur Kursabgabe — die aktuelle AgroScan-Version v1.0."}},
    {"version": "v2.0", "title": {"en": "ML model improvements", "de": "ML-Modell-Verbesserungen"}, "done": False,
     "desc": {"en": "More data sources, local input, and higher-resolution predictions.",
              "de": "Mehr Datenquellen, lokale Eingaben und Vorhersagen in höherer Auflösung."}},
    {"version": "v2.1", "title": {"en": "Community forum", "de": "Community-Forum"}, "done": False,
     "desc": {"en": "Connect with other farmers and share AgroScan ideas.",
              "de": "Mit anderen Landwirt:innen vernetzen und AgroScan-Ideen teilen."}},
    {"version": "v2.2", "title": {"en": "Baseline & historic analysis", "de": "Baseline- & Verlaufsanalyse"}, "done": False,
     "desc": {"en": "Historic analyses and baseline charts for your fields.",
              "de": "Historische Analysen und Baseline-Diagramme für deine Felder."}},
    {"version": "v2.3", "title": {"en": "Track your progress", "de": "Fortschritt verfolgen"}, "done": False,
     "desc": {"en": "SOC goals, progress tracking, and light gamification.",
              "de": "SOC-Ziele, Fortschrittsverfolgung und leichte Gamification."}},
    {"version": "v2.4", "title": {"en": "Chatbot recommendations", "de": "Chatbot-Empfehlungen"}, "done": False,
     "desc": {"en": "Personalized recommendations for sustainable soil management.",
              "de": "Personalisierte Empfehlungen für nachhaltiges Bodenmanagement."}},
]

# Neue Teammitglieder: Eintrag hier ergänzen.
# photo: Dateiname in static/assets/team/ — oder None für Platzhalter
TEAM_MEMBERS = [
    {"name": "Clara Buller",   "photo": "Clara.jpg",
     "role": {"en": "Master Student in Energy Science and Technology", "de": "Masterstudentin Energy Science and Technology"},
     "bio": {"en": "Interactive ML model development, Website UX design support, Website content development, Project report, Literature review",
             "de": "Interaktive ML-Modellentwicklung, UX-Design der Website, Website-Inhalte, Projektbericht, Literaturrecherche"}},
    {"name": "Margarete Breitenhuber", "photo": "Maggie.jpg",
     "role": {"en": "Master Student in Mechanical Engineering", "de": "Masterstudentin Maschinenbau"},
     "bio": {"en": "Interactive ML model development, Website-ML model communication, Website UX design support, User case research, Literature review",
             "de": "Interaktive ML-Modellentwicklung, Website-ML-Kommunikation, UX-Design der Website, Nutzerforschung, Literaturrecherche"}},
    {"name": "Jerome Reiter", "photo": "Jerome.jpg",
     "role": {"en": "Bachelor Student in Computational Science and Engineering", "de": "Bachelorstudent Computational Science and Engineering"},
     "bio": {"en": "Backend and frontend development, Map design and personal dashboard, Project pitch, Literature review",
             "de": "Backend- und Frontend-Entwicklung, Kartendesign und Personal Dashboard, Projektpitch, Literaturrecherche"}},
    {"name": "Claudio Bussinger", "photo": "Claudio.jpg",
     "role": {"en": "Bachelor Student in Computational Science and Engineering", "de": "Bachelorstudent Computational Science and Engineering"},
     "bio": {"en": "Backend and frontend development, Map design and website design, Project pitch, Literature review",
             "de": "Backend- und Frontend-Entwicklung, Kartendesign und Website-Design, Projektpitch, Literaturrecherche"}},
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
        "api_url":       _api_base_url(),
        "lang":          lang,
        "static_css_version": STATIC_CSS_VERSION,
        # analysis.html erwartet `leaflet_translations` (wird im JS geparst)
        "leaflet_translations": LEAFLET_DRAW_TRANSLATIONS.get(lang, {}),
        "dashboard_ui": DASHBOARD_UI.get(lang, DASHBOARD_UI["en"]),
        "map_ui": MAP_UI.get(lang, MAP_UI["en"]),
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

DASHBOARD_UI = {
    "en": {
        "unnamed_field": "Unnamed Field",
        "no_analyses": "No saved analyses yet.",
        "no_match": "No fields match your filters.",
        "one_analysis": "1 analysis",
        "n_analyses": "{n} analyses",
        "one_event": "1 event",
        "n_events": "{n} events",
        "all_time": "All-time",
        "vs_prev": "vs. prev.",
        "latest_avg_oc": "Latest Avg OC",
        "current_vs": "Current vs:",
        "first_sample": "First sample:",
        "recent_sample": "Recent sample:",
        "select_compare": "Select for comparison",
        "click_explore": "Click to explore ›",
        "oc_over_time": "OC over time",
        "date": "Date",
        "details": "Details",
        "delete": "Delete",
        "download_csv": "Download CSV",
        "download_field_data": "Download field data",
        "click_to_see_analyses_events": "Click to see all analyses and events",
        "analyses_section": "Analyses",
        "events_section": "Events",
        "delete_confirm": "Delete this analysis?",
        "delete_failed": "Delete failed: {msg}",
        "save_failed": "Save failed: {msg}",
        "compare_min_fields": "Please select at least 2 fields for comparison.",
        "compare_title": "Field Comparison — Average OC (g/kg) over Time",
        "filters": "Filters ▾",
        "filters_open": "Filters ▴",
        "filters_active": "Filters (active) ▴",
        "filter_summary": "Showing <b>{shown}</b> of <b>{total}</b> fields — {parts}",
        "filter_name": 'name contains "<b>{val}</b>"',
        "filter_crop": 'crop = "<b>{val}</b>"',
        "filter_from": "from <b>{val}</b>",
        "filter_to": "to <b>{val}</b>",
        "all_crops": "All crops",
        "chart_maximum": "Maximum",
        "chart_average": "Average",
        "chart_minimum": "Minimum",
        "point": "point",
        "points": "points",
    },
    "de": {
        "unnamed_field": "Unbenanntes Feld",
        "no_analyses": "Noch keine Analysen gespeichert.",
        "no_match": "Keine Felder entsprechen deinen Filtern.",
        "one_analysis": "1 Analyse",
        "n_analyses": "{n} Analysen",
        "one_event": "1 Ereignis",
        "n_events": "{n} Ereignisse",
        "all_time": "Gesamt",
        "vs_prev": "vs. vorh.",
        "latest_avg_oc": "Aktueller Ø OC",
        "current_vs": "Aktuell vs.:",
        "first_sample": "Erste Messung:",
        "recent_sample": "Letzte Messung:",
        "select_compare": "Zum Vergleich auswählen",
        "click_explore": "Zum Erkunden klicken ›",
        "oc_over_time": "OC im Zeitverlauf",
        "date": "Datum",
        "details": "Details",
        "delete": "Löschen",
        "download_csv": "CSV herunterladen",
        "download_field_data": "Felddaten herunterladen",
        "click_to_see_analyses_events": "Klicken, um alle Analysen und Ereignisse anzuzeigen",
        "analyses_section": "Analysen",
        "events_section": "Ereignisse",
        "delete_confirm": "Diese Analyse löschen?",
        "delete_failed": "Löschen fehlgeschlagen: {msg}",
        "save_failed": "Speichern fehlgeschlagen: {msg}",
        "compare_min_fields": "Bitte mindestens 2 Felder zum Vergleich auswählen.",
        "compare_title": "Feldvergleich — Durchschnittlicher OC (g/kg) im Zeitverlauf",
        "filters": "Filter ▾",
        "filters_open": "Filter ▴",
        "filters_active": "Filter (aktiv) ▴",
        "filter_summary": "<b>{shown}</b> von <b>{total}</b> Feldern — {parts}",
        "filter_name": 'Name enthält „<b>{val}</b>"',
        "filter_crop": 'Kultur = „<b>{val}</b>"',
        "filter_from": "ab <b>{val}</b>",
        "filter_to": "bis <b>{val}</b>",
        "all_crops": "Alle Kulturen",
        "chart_maximum": "Maximum",
        "chart_average": "Durchschnitt",
        "chart_minimum": "Minimum",
        "point": "Messpunkt",
        "points": "Messpunkte",
    },
}

MAP_UI = {
    "en": {
        "ready": "Ready ✓",
        "no_polygon": "No Polygon",
        "search_placeholder": "Search location or coordinates...",
        "search_error": "Location not found",
        "layer_satellite": "Satellite",
        "layer_analysis": "Analysis",
        "layer_labels": "Labels",
        "layer_drawings": "Drawings",
        "layer_results": "Results",
        "backend_unreachable": "Backend unreachable:\n{msg}",
        "custom_crop_required": "Please enter a custom crop name",
        "save_failed": "Could not save analysis",
        "no_layers_edit": "No layers to edit",
        "no_layers_delete": "No layers to delete",
        "edit_tooltip": "Drag handles or markers to edit features",
        "edit_subtext": "Click cancel to undo changes",
        "remove_tooltip": "Click on a feature to remove",
        "analysis_date": "Analysis date",
        "point": "point",
        "points": "points",
    },
    "de": {
        "ready": "Bereit ✓",
        "no_polygon": "Kein Polygon",
        "search_placeholder": "Ort oder Koordinaten suchen…",
        "search_error": "Ort nicht gefunden",
        "layer_satellite": "Satellit",
        "layer_analysis": "Analyse",
        "layer_labels": "Beschriftungen",
        "layer_drawings": "Zeichnungen",
        "layer_results": "Ergebnisse",
        "backend_unreachable": "Backend nicht erreichbar:\n{msg}",
        "custom_crop_required": "Bitte einen eigenen Kulturtyp eingeben",
        "save_failed": "Analyse konnte nicht gespeichert werden",
        "no_layers_edit": "Keine Layer zum Bearbeiten",
        "no_layers_delete": "Keine Layer zum Löschen",
        "edit_tooltip": "Griffe oder Marker ziehen, um Elemente zu bearbeiten",
        "edit_subtext": "Abbrechen klicken, um Änderungen rückgängig zu machen",
        "remove_tooltip": "Auf ein Element klicken, um es zu entfernen",
        "analysis_date": "Analysedatum",
        "point": "Messpunkt",
        "points": "Messpunkte",
    },
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
        oc_classification=oc_classification_meta(lang),
    ))

@app.get("/future_work", response_class=HTMLResponse)
async def future_work(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/future_work.html", ctx(
        request, "future_work", lang,
    ))

@app.get("/how_to", response_class=HTMLResponse)
async def how_to(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/how_to.html", ctx(
        request, "how_to", lang,
        oc_classification=oc_classification_meta(lang),
    ))


@app.get("/personal_dashboard", response_class=HTMLResponse)
async def pers_dash(request: Request, lang: str = Cookie(default="en")):

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT * FROM analyses ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()

    analyses = [_analysis_from_row(r) for r in rows]

    return templates.TemplateResponse("pages/pers_dash.html", ctx(
        request, "pers_dash", lang,
        analyses=analyses,
        oc_classification=oc_classification_meta(lang),
    ))

@app.get("/report", response_class=HTMLResponse)
async def report(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/report.html", ctx(
        request, "report", lang,
        # seitenspezifische Daten hier:
        # my_data=MY_DATA,
    ))

@app.get("/users_analysis", response_class=HTMLResponse)
async def users_experience(request: Request, lang: str = Cookie(default="en")):
    return templates.TemplateResponse("pages/users_analysis.html", ctx(
        request, "users_analysis", lang,
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

def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    conn.execute("""
        CREATE TABLE IF NOT EXISTS field_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            field_name  TEXT    NOT NULL,
            date        DATE    NOT NULL,
            event_type  TEXT    NOT NULL DEFAULT 'other',
            description TEXT    NOT NULL DEFAULT '',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    return conn


@app.get("/api/field-events/{field_name}")
def get_field_events(field_name: str):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM field_events WHERE field_name = ? ORDER BY date ASC",
        (field_name,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/field-events")
def create_field_event(payload: dict):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO field_events (field_name, date, event_type, description) VALUES (?,?,?,?)",
        (payload["field_name"], payload["date"], payload["event_type"], payload.get("description", ""))
    )
    conn.commit()
    conn.close()
    return {"id": cur.lastrowid, **payload}


@app.delete("/api/field-events/{event_id}")
def delete_field_event(event_id: int):
    conn = get_db()
    conn.execute("DELETE FROM field_events WHERE id = ?", (event_id,))
    conn.commit()
    conn.close()
    return {"deleted": event_id}

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
    tier: str

class OCClassificationMeta(BaseModel):
    unit: str
    parameter: str
    depth_cm: str
    percentile_low: int
    percentile_high: int
    threshold_low_gkg: float
    threshold_high_gkg: float
    n_samples: int
    dataset_name: str
    reference_url: str
    reference_title: str
    dataset_note: str
    tier_descriptions: dict[str, str]
    colors: dict[str, str]
    colormap: str
    colormap_mode: str
    percentile_boundaries_gkg: list[float]
    discrete_percentiles: list[int]
    discrete_colors: list[str]
    discrete_bin_labels: list[str]
    discrete_bin_labels_short: list[str]
    colormap_note: str
    howto_map_intro: str
    howto_tier_groups: list[dict]

class PredictionResponse(BaseModel):
    zones: List[ZoneResult]
    unit: str
    classification: OCClassificationMeta
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


def _metadata_path(result_path: Path) -> Path:
    return result_path / "metadata.json"


def _sentinel_output_root() -> Path:
    override = os.environ.get("SENTINEL_DIR")
    if override:
        return Path(override)
    return PROJECT_ROOT.parent / "persistent-data" / "sentinel_output"


def _grid_match_radius_m() -> float:
    raw_value = os.environ.get("AGROSCAN_GRID_MATCH_RADIUS_M", str(DEFAULT_GRID_MATCH_RADIUS_M))
    try:
        return float(raw_value)
    except ValueError:
        return DEFAULT_GRID_MATCH_RADIUS_M


def _cached_sentinel_points_for_date(analysis_date: str | None) -> list[dict]:
    points: list[dict] = []
    root = _sentinel_output_root()

    def _collect_points(date_root: Path) -> None:
        for entry in sorted(date_root.iterdir(), key=lambda item: item.name):
            if not entry.is_dir() or entry.name.startswith("_"):
                continue
            if not _metadata_path(entry).is_file():
                continue

            try:
                lat_str, lng_str = entry.name.split(" ", 1)
                points.append(
                    {
                        "center_lat": float(lat_str),
                        "center_lng": float(lng_str),
                        "center_lat_text": lat_str,
                        "center_lng_text": lng_str,
                        "result_path": entry,
                    }
                )
            except ValueError:
                continue

    # The frontend analysis date is a survey date, while cache folders are keyed
    # by Sentinel acquisition date. Search all cached date roots so older runs can
    # still seed the grid anchor and nearest-point reuse logic.
    if analysis_date:
        preferred_root = root / analysis_date
        if preferred_root.is_dir():
            _collect_points(preferred_root)

    for date_root in sorted(root.iterdir(), key=lambda item: item.name):
        if not date_root.is_dir() or date_root.name.startswith("_"):
            continue
        if analysis_date and date_root.name == analysis_date:
            continue
        _collect_points(date_root)

    return points


def _anchor_reuse_score(
    anchor_x: float,
    anchor_y: float,
    cached_points: list[dict],
    cell_size_m: float,
    match_radius_m: float,
) -> tuple[int, float]:
    match_count = 0
    total_distance = 0.0

    for point in cached_points:
        offset_x = point["center_x_m"] - anchor_x
        offset_y = point["center_y_m"] - anchor_y

        grid_x = anchor_x + round(offset_x / cell_size_m) * cell_size_m
        grid_y = anchor_y + round(offset_y / cell_size_m) * cell_size_m
        distance = math.hypot(point["center_x_m"] - grid_x, point["center_y_m"] - grid_y)

        if distance <= match_radius_m:
            match_count += 1
            total_distance += distance

    return match_count, total_distance


def _choose_best_grid_anchor(
    poly_m: Polygon,
    cached_points: list[dict],
    cell_size_m: float,
    match_radius_m: float,
) -> tuple[float, float]:
    half = cell_size_m / 2.0
    minx, miny, _, _ = poly_m.bounds
    base_x = minx + half
    base_y = miny + half

    if not cached_points:
        return base_x, base_y

    search_step_m = 1.0
    search_steps = int(round(cell_size_m / search_step_m))
    centroid = poly_m.centroid

    best_anchor_x = base_x
    best_anchor_y = base_y
    best_score = (-1, float("inf"), float("inf"))

    for offset_x_step in range(search_steps):
        anchor_x = base_x + offset_x_step * search_step_m
        for offset_y_step in range(search_steps):
            anchor_y = base_y + offset_y_step * search_step_m

            match_count, total_distance = _anchor_reuse_score(
                anchor_x,
                anchor_y,
                cached_points,
                cell_size_m,
                match_radius_m,
            )

            if match_count == 0:
                continue

            centroid_distance = math.hypot(anchor_x - centroid.x, anchor_y - centroid.y)
            score = (match_count, -total_distance, -centroid_distance)
            if score > best_score:
                best_score = score
                best_anchor_x = anchor_x
                best_anchor_y = anchor_y

    return best_anchor_x, best_anchor_y


def _nearest_cached_point(
    x_m: float,
    y_m: float,
    cached_points: list[dict],
    match_radius_m: float,
) -> dict | None:
    best_match: dict | None = None
    best_distance = match_radius_m

    for point in cached_points:
        distance = math.hypot(point["center_x_m"] - x_m, point["center_y_m"] - y_m)
        if distance <= best_distance:
            best_distance = distance
            best_match = point

    if best_match is None:
        return None

    return {**best_match, "distance_m": best_distance}


def _grid_center_points_in_polygon(
    polygon_latlng: List[Coordinate],
    analysis_date: str | None = None,
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
    match_radius_m = _grid_match_radius_m()

    half = cell_size_m / 2.0

    t_forward = _transformer(4326, utm_epsg)
    t_back = _transformer(utm_epsg, 4326)

    cached_points = _cached_sentinel_points_for_date(analysis_date)
    cached_points_utm: list[dict] = []
    for cached_point in cached_points:
        x_m, y_m = t_forward.transform(cached_point["center_lng"], cached_point["center_lat"])
        cached_geom = Point(x_m, y_m)
        if poly_m.distance(cached_geom) > match_radius_m:
            continue
        cached_points_utm.append(
            {
                **cached_point,
                "center_x_m": float(x_m),
                "center_y_m": float(y_m),
            }
        )

    anchor_x, anchor_y = _choose_best_grid_anchor(poly_m, cached_points_utm, cell_size_m, match_radius_m)

    points = []

    min_row = math.floor((miny - anchor_y) / cell_size_m) - 1
    max_row = math.ceil((maxy - anchor_y) / cell_size_m) + 1
    min_col = math.floor((minx - anchor_x) / cell_size_m) - 1
    max_col = math.ceil((maxx - anchor_x) / cell_size_m) + 1

    for r in range(min_row, max_row + 1):
        y = anchor_y + r * cell_size_m
        for c in range(min_col, max_col + 1):
            x = anchor_x + c * cell_size_m
            cell_poly = box(x - half, y - half, x + half, y + half)
            pt = Point(x, y)
            inside = cell_poly.intersects(poly_m) if include_border else poly_m.contains(pt)
            if not inside:
                continue

            snapped_point = _nearest_cached_point(x, y, cached_points_utm, match_radius_m)

            lng, lat = t_back.transform(x, y)
            points.append(
                {
                    "row": int(r - min_row),
                    "col": int(c - min_col),
                    "center_x_m": float(x),
                    "center_y_m": float(y),
                    "center_lat": float(lat),
                    "center_lng": float(lng),
                    "center_lat_text": repr(float(lat)),
                    "center_lng_text": repr(float(lng)),
                    "source_x_m": float(snapped_point["center_x_m"] if snapped_point is not None else x),
                    "source_y_m": float(snapped_point["center_y_m"] if snapped_point is not None else y),
                    "source_lat": float(t_back.transform(
                        snapped_point["center_x_m"] if snapped_point is not None else x,
                        snapped_point["center_y_m"] if snapped_point is not None else y,
                    )[1]),
                    "source_lng": float(t_back.transform(
                        snapped_point["center_x_m"] if snapped_point is not None else x,
                        snapped_point["center_y_m"] if snapped_point is not None else y,
                    )[0]),
                    "source_lat_text": snapped_point["center_lat_text"] if snapped_point is not None else repr(float(lat)),
                    "source_lng_text": snapped_point["center_lng_text"] if snapped_point is not None else repr(float(lng)),
                    "uses_cached_image": bool(snapped_point is not None),
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
    lat_series = grid_csv["source_lat_text"] if "source_lat_text" in grid_csv.columns else (
        grid_csv["source_lat"] if "source_lat" in grid_csv.columns else grid_csv["center_lat"]
    )
    lng_series = grid_csv["source_lng_text"] if "source_lng_text" in grid_csv.columns else (
        grid_csv["source_lng"] if "source_lng" in grid_csv.columns else grid_csv["center_lng"]
    )
    gps_input_df = pd.DataFrame(
        {
            "POINTID": [f"pt_{index + 1}" for index in range(len(grid_csv))],
            "SURVEY_DATE": analysis_date,
            "TH_LAT": lat_series.astype(str).to_list(),
            "TH_LONG": lng_series.astype(str).to_list(),
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
        "1x1",
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


@app.get("/api/oc-classification")
def api_oc_classification(lang: str = "en"):
    if lang not in ("en", "de"):
        lang = "en"
    return oc_classification_meta(lang)


@app.get("/api/health")
def health():
    return {"status": "AgroScan API läuft ✅"}


@app.get("/healthz")
def healthz():
    """Used by Kubernetes/Helm probes (see helm/values.yaml components.backend.health)."""
    return {"status": "ok"}


@app.post("/api/predict", response_model=PredictionResponse)
def predict(request: FieldRequest, lang: str = Cookie(default="en")):
    if lang not in ("en", "de"):
        lang = "de"
    grid_cell_size_m = DEFAULT_GRID_CELL_SIZE_M
    print(
        f"[backend] /api/predict: received request with {len(request.polygon)} polygon points "
        f"and analysis_date={request.analysis_date}",
        flush=True,
    )
    print(
        f"[backend] /api/predict: building fixed grid with cell_size_m={grid_cell_size_m} and reuse_radius_m={_grid_match_radius_m()}",
        flush=True,
    )
    # 1) Build 60m grid centers (this is your "CSV" table)
    utm_epsg, grid_points = _grid_center_points_in_polygon(
        request.polygon,
        analysis_date=request.analysis_date,
        cell_size_m=grid_cell_size_m,
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
                "center_lat_text": p.get("center_lat_text", repr(float(p["center_lat"]))),
                "center_lng_text": p.get("center_lng_text", repr(float(p["center_lng"]))),
                "source_lat": p.get("source_lat", p["center_lat"]),
                "source_lng": p.get("source_lng", p["center_lng"]),
                "source_lat_text": p.get("source_lat_text", p.get("center_lat_text", repr(float(p["center_lat"])))),
                "source_lng_text": p.get("source_lng_text", p.get("center_lng_text", repr(float(p["center_lng"])))),
                "uses_cached_image": p.get("uses_cached_image", False),
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
    t_low, t_high, _ = lucas_oc_percentile_thresholds()
    zones = []
    values = []
    for p, value in zip(grid_points, y):
        v = float(value)
        values.append(v)
        cell_poly = _cell_polygon_latlng_from_center(
            center_x_m=p["center_x_m"],
            center_y_m=p["center_y_m"],
            cell_size_m=grid_cell_size_m,
            utm_epsg=utm_epsg,
        )
        zones.append(
            ZoneResult(
                sub_polygon=cell_poly,
                value=round(v, 2),
                label=oc_tier_label(v, t_low, t_high, lang=lang),
                tier=oc_tier(v, t_low, t_high),
            )
        )
    print(f"[backend] /api/predict: created {len(zones)} prediction zones", flush=True)

    classification = OCClassificationMeta(**oc_classification_meta(lang))

    return PredictionResponse(
        zones=zones,
        unit="g/kg OC",
        classification=classification,
        min_value=round(min(values), 2) if values else 0.0,
        max_value=round(max(values), 2) if values else 0.0,
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
            field_area_ha,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

        _calculate_area_ha(req.polygon),

        datetime.now().isoformat()
    ))

    conn.commit()
    conn.close()

    return {"status": "saved"}

@app.get("/api/analyses")
def get_analyses():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT * FROM analyses ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()

    return [_analysis_from_row(r) for r in rows]

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

def _fetch_events(c, field_names: list[str] | None = None) -> list[dict]:
    if field_names is not None:
        if not field_names:
            return []
        placeholders = ",".join("?" * len(field_names))
        rows = c.execute(
            f"SELECT * FROM field_events WHERE field_name IN ({placeholders}) "
            "ORDER BY date DESC, id DESC",
            field_names,
        ).fetchall()
    else:
        rows = c.execute(
            "SELECT * FROM field_events ORDER BY field_name ASC, date DESC, id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def _export_to_csv(analyses: list[dict], events: list[dict]) -> str:
    output = StringIO()
    writer = csv.writer(output, delimiter=";")

    writer.writerow([
        "ID",
        "Date",
        "Crop",
        "Field Name",
        "Location",
        "Notes",
        "Avg (g/kg OC)",
        "Min (g/kg OC)",
        "Max (g/kg OC)",
        "Polygon Points",
        "Zones Count",
        "Field Area (ha)",
        "Created At",
    ])

    for a in analyses:
        polygon = a.get("polygon") or []
        zones = a.get("zones") or []
        poly_len = len(polygon) if isinstance(polygon, list) else 0
        zone_len = len(zones) if isinstance(zones, list) else 0

        writer.writerow([
            a.get("id"),
            a.get("date"),
            a.get("crop"),
            a.get("field_name"),
            a.get("location_name"),
            a.get("notes"),
            round(a.get("avg_value", 0), 1),
            round(a.get("min_value", 0), 1),
            round(a.get("max_value", 0), 1),
            poly_len,
            zone_len,
            round(a.get("field_area_ha", 0), 3),
            a.get("created_at"),
        ])

    writer.writerow([])
    writer.writerow(["Field Events"])
    writer.writerow([
        "Event ID",
        "Field Name",
        "Date",
        "Event Type",
        "Description",
        "Created At",
    ])

    for ev in events:
        writer.writerow([
            ev.get("id"),
            ev.get("field_name"),
            ev.get("date"),
            ev.get("event_type"),
            ev.get("description"),
            ev.get("created_at"),
        ])

    output.seek(0)
    return output.getvalue()

from fastapi.responses import Response

@app.get("/api/analyses/{id}/csv")
def download_single_csv(id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT * FROM analyses WHERE id = ?", (id,))
    r = c.fetchone()

    if not r:
        conn.close()
        return {"error": "not found"}

    analysis = _analysis_from_row(r)
    field_name = (analysis.get("field_name") or "").strip()
    events = _fetch_events(c, [field_name]) if field_name else []

    conn.close()

    csv_data = _export_to_csv([analysis], events)

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=analysis_{id}.csv"
        }
    )

@app.get("/api/analyses/field/{field_name}/csv")
def download_field_csv(field_name: str):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute(
        "SELECT * FROM analyses WHERE field_name = ? ORDER BY date DESC",
        (field_name,),
    )
    rows = c.fetchall()

    if not rows:
        conn.close()
        return {"error": "not found"}

    analyses = [_analysis_from_row(r) for r in rows]
    events = _fetch_events(c, [field_name])
    conn.close()

    safe_name = field_name.replace("/", "_").replace("\\", "_")
    csv_data = _export_to_csv(analyses, events)

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=field_{safe_name}.csv"
        },
    )

@app.get("/api/analyses/csv")
def download_all_csv():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT * FROM analyses ORDER BY id DESC")
    rows = c.fetchall()
    analyses = [_analysis_from_row(r) for r in rows]
    events = _fetch_events(c)
    conn.close()

    csv_data = _export_to_csv(analyses, events)

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