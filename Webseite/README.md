# 🌱 AgroScan – ML Flächenanalyse

Starter-Template: User zeichnet Polygon → ML-Modell analysiert → Karte mit Farbzonen.

## Projektstruktur

```
agroscan/
├── backend/
│   ├── main.py            ← FastAPI Server + ML-Modell Placeholder
│   └── requirements.txt
└── frontend/
    └── index.html         ← Karte + UI (kein Build-Schritt nötig)
```

---

## 🚀 Lokal starten

### 1. Backend

```bash
cd backend

# Virtuelle Umgebung erstellen (einmalig)
python -m venv venv
source venv/bin/activate        # Mac/Linux
# venv\Scripts\activate         # Windows

# Abhängigkeiten installieren
pip install -r requirements.txt

# Server starten
uvicorn main:app --reload
# → läuft auf http://localhost:8000
# → API-Docs: http://localhost:8000/docs
```

### 2. Frontend
`http://localhost:8000`im Webbrowser öffnen um die Webseite zu sehen

---

## 🧠 Dein ML-Modell einbauen

In `backend/main.py` die Funktion `run_model()` ersetzen:

```python
import pickle
import numpy as np

# Modell beim Start laden (einmalig)
model = pickle.load(open("model.pkl", "rb"))

def run_model(sub_polygon) -> float:
    # 1. Features aus Koordinaten extrahieren
    features = extract_features(sub_polygon)  # deine Funktion
    
    # 2. Vorhersage
    prediction = model.predict([features])[0]
    
    # 3. Auf 0–1 normalisieren (falls nötig)
    return float(prediction)
```

---

## ☁️ Deployment

### Backend → Render (gratis)

1. GitHub Repo erstellen, Code pushen
2. render.com → "New Web Service" → Repo verbinden
3. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Deine URL: `https://agroscan-backend.onrender.com`

### Frontend → Netlify (gratis)

1. netlify.com → "Add new site" → `frontend/` Ordner hochladen
2. In `script.js` die `API_URL` auf deine Render-URL ändern:
   ```javascript
   const API_URL = "https://agroscan-backend.onrender.com";
   ```

---

## 🔧 Nützliche VS Code Extensions

- **Live Server** – Frontend ohne Server öffnen
- **Python** (Microsoft) – Python Support
- **REST Client** – API direkt in VS Code testen
- **GitLens** – Git-Integration
