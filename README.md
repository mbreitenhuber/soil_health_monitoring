# Here Be Dragons

A simple example project with a **React** frontend and **FastAPI** backend, deployed via GitLab CI using the [generic-helm-chart](https://gitlab.inf.ethz.ch/ou-ivia/generic-helm-chart).

## Architecture

```
┌─────────────┐       GET /api/dragons       ┌─────────────┐
│   Frontend   │  ──────────────────────────▶ │   Backend    │
│  (React/Nginx)│ ◀────── { "n": 7 } ─────── │  (FastAPI)   │
│   port 80    │                              │  port 8000   │
└─────────────┘                              └─────────────┘
```

The frontend displays **"Here Be N Dragons"** where N is a random number (2–20) fetched from the backend on each click.

## Local Development

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
VITE_API_URL=http://localhost:8000 npm run dev
```

## Deployment

The `.gitlab-ci.yml` pipeline:

1. **prepare** — exports environment variables (URLs, image names)
2. **build** — builds Docker images for `frontend` and `backend` using Buildah
3. **deploy** — deploys each service individually using the **generic-helm-chart**

### CI/CD Variables Required

| Variable | Description |
|---|---|
| `KUBECONFIG_B64` | Base64-encoded kubeconfig |
| `K8S_NAMESPACE` | Target Kubernetes namespace |
| `CI_REGISTRY_USER` | Container registry username |
| `CI_REGISTRY_PWD` | Container registry password |

### Helm Values

- `helm/frontend.yaml` — frontend service configuration
- `helm/backend.yaml` — backend service configuration

Each service is deployed as a separate Helm release using the generic chart, replacing the old fullstack chart pattern.
