# Nebula – Sentinel‑basierte Feldanalyse (ML) + Web-App

Nebula ist ein Open-Source Projekt für **satelliten-gestütztes Monitoring von Bodengesundheit**.
Ziel ist es, dass Landwirt:innen ein Feld als Polygon auf der Karte zeichnen und wir dieses Feld mit einem **ML‑Modell** analysieren – basierend auf **Sentinel‑1 (SAR)** und **Sentinel‑2 (multispektral)** Daten – und anschließend das Polygon in **Zonen einfärben** (z.B. “hoch/mittel/niedrig”).

Aktuell enthält das Repo bereits:

- **Web-App (FastAPI + Jinja)**: UI zum Polygon-Zeichnen, Analyse starten, Ergebnis als farbige Zonen anzeigen und Analysen speichern.
- **Daten-/ML‑Code**: Ordner für Datenaufbereitung, Modelltraining und Inferenz (WIP/inkrementell).

## Repository-Struktur (Überblick)

```
.
├── backend/                  # Web-Backend: FastAPI (HTML + JSON API)
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                 # Nur Templates + statische Assets (werden vom Backend served)
│   ├── templates/
│   └── static/
├── analysis/                 # Daten-/Feature-Pipeline (EO Processing, Utilities, etc.)
├── AgroLens/                 # Modell-/Pipeline-Code (Training/Inference/Utilities; je nach Stand)
├── Sentinel1/                # Sentinel-1 spezifische Scripts/Notebooks/Daten (je nach Stand)
├── data/                     # Datensätze, Modelle, Beispielinputs/outputs
├── docs/                     # Dokumentation & Hintergrund
├── helm/                     # Helm values (GitLab Deployment)
│   └── values.yaml
├── .gitlab-ci.yml            # GitLab CI: build + deploy (nur Backend)
└── requirements.txt          # Allgemeine Python deps fürs Repo (nicht fürs Backend-Image)
```

## End-to-End Flow (wie alles zusammenhängt)

1. **User zeichnet Polygon** in der Web-App (Karte).
2. Frontend sendet das Polygon an das Backend (`POST /api/predict`).
3. Backend erzeugt ein Raster/Unterzonen und führt **Modell-Inferenz** aus (Sentinel‑Features → Score pro Zone).
4. Backend liefert Zonen-Polygone + Werte zurück → Frontend färbt die Karte.

## Lokal starten (Webseite)

```bash
cd backend

python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload
```

Danach im Browser öffnen: `http://localhost:8000`

## Wie die Webseite technisch funktioniert

- **Server-side Rendering**: Die Seiten sind Jinja-Templates in `frontend/templates/**` und werden von FastAPI in `backend/main.py` gerendert.
- **Statische Dateien**: CSS/JS/Bilder liegen in `frontend/static/**` und werden unter `/static/...` ausgeliefert.
- **API Calls**: Das Frontend nutzt same-origin Requests (z.B. `/api/predict`), ohne hardcodiertes `localhost`.

## ML-Modell: wo es “eingehängt” wird

- Die Web-Inferenz läuft über den Endpoint **`POST /api/predict`** in `backend/main.py`.
- Dort wird aktuell (Stand jetzt) ein **Placeholder** genutzt. Um euer echtes Modell zu verwenden, ersetzt ihr die Modellfunktion (oder ruft euren Modellcode aus `analysis/` / `AgroLens/` auf) und gebt pro Zone einen Score zurück.

## GitLab Deployment (automatisch)

Das Deployment läuft über GitLab CI + Helm und deployed **nur den Backend-Container**.

- **Trigger**: Pipeline läuft nur bei Push/Merge auf den Branch `main`.
- **Build**: baut das Docker-Image aus `backend/` und pushed es in die GitLab Container Registry.
- **Deploy**: `helm upgrade --install` mit `helm/values.yaml`.

### Notwendige GitLab CI/CD Variablen

Diese Variablen müssen im GitLab Projekt (oder in der Gruppe) gesetzt sein:

- `K8S_NAMESPACE`: Kubernetes Namespace für das Deployment
- `KUBECONFIG_B64`: base64-encodierte kubeconfig
- `CI_REGISTRY_USER`, `CI_REGISTRY_PWD`: Zugriff auf die Container Registry
- `BASE_URL`: Basis-Domain für die generierte URL

Wenn alles gesetzt ist und ihr auf `main` pusht, sollte GitLab die Webseite automatisch deployen. 
