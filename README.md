# Agro scan

This platform is designed to monitor soil health using Earth Observation data derived from satellite imagery. By enabling large-scale and accessible soil monitoring, it supports the development of productive, resilient, and sustainable agricultural systems. The platform contributes to the European Union’s Soil Monitoring Goal 2030 by providing digital tools for the continuous assessment of agricultural soils.
At its current stage, the platform focuses specifically on soil organic carbon (SOC), as SOC is one of the key indicators of soil health and is strongly linked to soil fertility, ecosystem functioning, and long-term agricultural sustainability. The current implementation is limited to agricultural areas in Germany.

---

## The Mission

The platform is accessible through an interactive website where farmers can select individual fields and run analyses. The SOC estimation is generated using a machine learning model trained on reference data from the LUCAS Soil Survey soil dataset together with satellite imagery from Copernicus Sentinel-2. The underlying model architecture is based on a fully connected neural network capable of identifying relationships between spectral information and measured soil organic carbon values. After an analysis is completed, users can save their results and monitor the soil development over time.

The generated results can support farmers, agronomists, and researchers in both agricultural management and policy-making processes. By having access to the SOC levels, the platform can help farmers make more informed decisions regarding practices such as cover cropping, reduced tillage, manure or compost application, crop rotation, and grazing management. These practices contribute to improved soil quality and sustainable land use. Enhanced soil quality can in turn improve soil fertility, increase water retention capacity, strengthen drought resistance, improve soil structure, and reduce erosion risks. Additional information about soil health, monitoring methods, and the platform itself can be found on the project website.

---

 ## Repository Structure

```
.
├── AgroScan/                 # Core model and pipeline code for training, inference, and satellite-data processing.
│   ├── nutrients_predictor/  # Predictor modules and training/inference helpers for soil nutrients.
│   ├── satellite_utils/      # Satellite data access and preprocessing utilities (Sentinel, USGS, etc.).
│   └── scripts/              # Pipeline helper scripts for data preparation and execution.
├── backend/                  # FastAPI backend for the website, including API routes and server-side rendering.
│   ├── persistent-data/       # Mounted volume for durable runtime data, including agroscan.db.
│   ├── main.py               # FastAPI application entrypoint and HTTP routes.
│   └── Dockerfile
├── frontend/                 # Jinja templates and static assets for the web UI.
│   ├── templates/
│   └── static/
├── helm/                     # Helm charts and configuration for Kubernetes deployment.
│   └── values.yaml
├── data/                     # Datasets, model artifacts, input/output files.
├── .env.expampe              # Example environment variables for local setup.
├── .gitignore                 
├── .gitlab-ci.yml            
├── band_ranges.json          # Band range configuration data for data processing. 
├── environment.yml           # Conda environment definition for the Python setup.
├── index_ranges.json         # Index range configuration data for data processing.
├── README.md                 
└── requirements.txt          # Shared Python dependencies for the repo.
```

> **Sidenote:** _The repository currently contains additional files and legacy folders that are not required to run the project. The tree above lists the files and directories needed to start and run the repository; other files will be cleaned up in a future refactor._

---

## Deployment in Docker

1. Start Docker Desktop and make sure the Docker engine is running.

2. Build the backend image:

```powershell/bash
docker build -f backend/Dockerfile -t nebula-backend:latest backend
```

3. Start the container

```powershell
docker run --rm -d --name nebula-web -p 8000:8000 `
	-v "${PWD}\persistent-data:/persistent-data" `
	-e SENTINEL_DIR=/persistent-data/sentinel_output `
	-e TMP_DIR=/persistent-data/tmp `
	--env-file backend\.env `
	nebula-backend:latest
```

```bash
docker run --rm -d --name nebula-web -p 8000:8000 \
	-v "$(pwd)/persistent-data:/persistent-data" \
	-e SENTINEL_DIR=/persistent-data/sentinel_output \
	-e TMP_DIR=/persistent-data/tmp \
	--env-file backend/.env \
	nebula-backend:latest
```

4. View the logs:

```powershell/bash
docker logs -f nebula-web
```

5. Open the website in your browser:

http://localhost:8000/

6. Stop the container when you are done:

```powershell/bash
docker stop nebula-web
```