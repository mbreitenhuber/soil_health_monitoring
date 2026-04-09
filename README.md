# Here Be Dragons

A small example with a **React** (Vite) frontend and **FastAPI** backend, built in GitLab CI and deployed with the [generic helm chart](https://gitlab.inf.ethz.ch/ou-ivia/generic-helm-chart) published as OCI at `harbor.ivia.ch`.

## Architecture

In production the browser loads the SPA from the frontend ingress host. The app calls the API on the **backend host**: same hostname as the frontend, with a `be.` prefix (see `frontend/src/App.jsx`).

```
Browser ──HTTPS──▶ Frontend ingress (nginx, static React)
       └──HTTPS──▶ Backend ingress (FastAPI)  at https://be.<frontend-host>/api/dragons
```

There is **no** nginx reverse proxy in the frontend image; the backend is reached at its public URL.

The UI shows **“Here Be N Dragons”** where **N** is a random integer from 2–20 returned by `GET /api/dragons`.

## Repository layout

| Path | Role |
|------|------|
| `frontend/` | Vite + React, production image serves static files with nginx |
| `backend/` | FastAPI + uvicorn on port 8000 |
| `helm/values.yaml` | Enables `components.frontend` and `components.backend` for the generic chart |
| `.gitlab-ci.yml` | Prepare → Buildah images → single `helm upgrade` deploy |

## Local development

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The built-in API base URL is `https://be.${window.location.hostname}`. On plain `localhost` that becomes `https://be.localhost`, which usually does not match a local backend. For local API testing you can temporarily change the `API_URL` constant in `frontend/src/App.jsx` to `http://localhost:8000`, or use hostnames that mirror production (e.g. entries in `/etc/hosts` plus TLS if you need `https`).

## GitLab CI/CD pipeline

Stages and jobs match `.gitlab-ci.yml`:

1. **prepare** — `export-environment` derives shortened project name, `RELEASE_NAME`, registry image path, and ingress hostnames (`URL_FRONTEND`, `URL_BACKEND`).
2. **build** — `build:buildah` matrix builds and pushes `frontend` and `backend` images (`Dockerfile` in each directory). Uses tag `ivialab-student-cluster`.
3. **deploy** — `deploy-app` runs one `helm upgrade --install` for release `${RELEASE_NAME}` using chart `oci://harbor.ivia.ch/ivia-generic-helm-chart/ivia-generic-helm-chart` at version `HELM_CHART_VERSION` (currently `4.1.4`), values file `helm/values.yaml`, plus `--set` overrides for image repositories, ingress URLs, and backend `CORS_ORIGINS`.

**Deployment rules:** jobs that extend `.deployment-trigger-rules` run only on branch `main`.

**Default job tags:** `runner-shared` (build overrides with `ivialab-student-cluster`).

### CI/CD variables

| Variable | Description |
|----------|-------------|
| `BASE_URL` | DNS suffix for public URLs (e.g. `xaiml26.ivia.isginf.ch`). Frontend host: `<short-project>.${BASE_URL}`; backend: `be.<short-project>.${BASE_URL}`. |
| `KUBECONFIG_B64` | Base64-encoded kubeconfig for the deploy job |
| `K8S_NAMESPACE` | Target Kubernetes namespace |
| `CI_REGISTRY_USER` / `CI_REGISTRY_PWD` | GitLab container registry (Buildah login and `helm registry login`) |

Helm sets `components.backend.extraEnv.CORS_ORIGINS` to `https://${URL_FRONTEND}` so the browser may call the backend from the frontend origin.

### Helm

- **Single release** — both frontend and backend are subcomponents of one install (`components.frontend` / `components.backend` in `helm/values.yaml`).
- **CI overrides** — image repositories and `ingress.url` values are supplied with `helm upgrade ... --set` in `deploy-app`.
