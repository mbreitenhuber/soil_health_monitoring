from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import numpy as np
import random

app = FastAPI(title="Agri-ML API")

# CORS erlaubt dem Frontend, mit dem Backend zu kommunizieren
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In Produktion: nur deine Domain eintragen
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Datenmodelle ──────────────────────────────────────────────────────────────

class Coordinate(BaseModel):
    lat: float
    lng: float

class FieldRequest(BaseModel):
    polygon: List[Coordinate]   # Eckpunkte der Landwirtschaftsfläche
    # Optional: weitere Eingaben des Users, z.B.:
    # crop_type: str
    # year: int

class ZoneResult(BaseModel):
    sub_polygon: List[Coordinate]   # Teil-Polygon (Unter-Zone)
    value: float                    # Vorhergesagter Wert (0.0 – 1.0)
    label: str                      # z.B. "Hoch", "Mittel", "Niedrig"

class PredictionResponse(BaseModel):
    zones: List[ZoneResult]
    unit: str                       # z.B. "Bodenqualität", "Ertragspotenzial"
    min_value: float
    max_value: float


# ── Hilfsfunktion: Polygon in Gitter-Zonen aufteilen ─────────────────────────

def split_polygon_into_grid(polygon: List[Coordinate], grid_size: int = 3):
    """
    Teilt das Bounding-Box des Polygons in ein grid_size x grid_size Gitter auf.
    In einer echten App: verwende shapely für präzises Polygon-Clipping.
    """
    lats = [p.lat for p in polygon]
    lngs = [p.lng for p in polygon]
    min_lat, max_lat = min(lats), max(lats)
    min_lng, max_lng = min(lngs), max(lngs)

    lat_step = (max_lat - min_lat) / grid_size
    lng_step = (max_lng - min_lng) / grid_size

    zones = []
    for i in range(grid_size):
        for j in range(grid_size):
            cell = [
                Coordinate(lat=min_lat + i * lat_step,       lng=min_lng + j * lng_step),
                Coordinate(lat=min_lat + (i+1) * lat_step,   lng=min_lng + j * lng_step),
                Coordinate(lat=min_lat + (i+1) * lat_step,   lng=min_lng + (j+1) * lng_step),
                Coordinate(lat=min_lat + i * lat_step,       lng=min_lng + (j+1) * lng_step),
            ]
            zones.append(cell)
    return zones


# ── ML-Modell Placeholder ─────────────────────────────────────────────────────

def run_model(sub_polygon: List[Coordinate]) -> float:
    """
    PLATZHALTER – hier kommt dein echtes ML-Modell rein.

    Typischer Ablauf mit einem echten Modell:
        1. Features aus den Koordinaten extrahieren
           (z.B. Satellitendaten, Bodendaten via API laden)
        2. Features in numpy array umwandeln
        3. model.predict(features) aufrufen
        4. Ergebnis zurückgeben

    Beispiel mit scikit-learn:
        import pickle
        model = pickle.load(open("model.pkl", "rb"))
        features = extract_features(sub_polygon)  # deine Funktion
        return float(model.predict([features])[0])
    """
    # Simuliert räumlich variierende Werte (nur für Demo)
    center_lat = np.mean([p.lat for p in sub_polygon])
    center_lng = np.mean([p.lng for p in sub_polygon])
    value = (np.sin(center_lat * 50) + np.cos(center_lng * 50) + 2) / 4
    value += random.uniform(-0.05, 0.05)  # etwas Rauschen
    return float(np.clip(value, 0, 1))


def value_to_label(value: float) -> str:
    if value >= 0.66:
        return "Hoch"
    elif value >= 0.33:
        return "Mittel"
    else:
        return "Niedrig"


# ── API Endpoints ──────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "Agri-ML API läuft ✅"}


@app.post("/predict", response_model=PredictionResponse)
def predict(request: FieldRequest):
    """
    Nimmt ein Polygon (Eckpunkte der Landwirtschaftsfläche) entgegen,
    teilt es in Zonen auf, und gibt für jede Zone einen ML-Vorhersagewert zurück.
    """
    sub_polygons = split_polygon_into_grid(request.polygon, grid_size=4)

    zones = []
    for sub_poly in sub_polygons:
        value = run_model(sub_poly)
        zones.append(ZoneResult(
            sub_polygon=sub_poly,
            value=round(value, 3),
            label=value_to_label(value)
        ))

    return PredictionResponse(
        zones=zones,
        unit="Bodenqualität",   # ← anpassen je nach Modell
        min_value=0.0,
        max_value=1.0
    )
