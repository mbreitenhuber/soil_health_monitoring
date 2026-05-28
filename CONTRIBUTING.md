# Contributing

Thanks for helping improve AgroScan. This document explains the expected workflow for changes in this repository.


## Project Layout

- `backend/` contains the FastAPI application and the satellite-processing pipeline.
- `backend/AgroScan/` contains the core pipeline code for data preparation, prediction, and satellite utilities.
- `frontend/` contains the templates and static JavaScript/CSS for the web UI.
- `data/` contains datasets, models, and generated artifacts.

## Local Setup

Use the same environment and deployment approach as described in the README.

```powershell
docker build -f backend/Dockerfile -t nebula-backend:latest backend
docker run --rm -d --name nebula-web -p 8000:8000 `
	-v "${PWD}\persistent-data:/persistent-data" `
	-e SENTINEL_DIR=/persistent-data/sentinel_output `
	-e TMP_DIR=/persistent-data/tmp `
	--env-file backend\.env `
	nebula-backend:latest
```

Open the app at http://localhost:8000/ and use `docker logs -f nebula-web` if you need to inspect runtime output.

If you change backend code, rebuild the container before testing again.

## Working on Changes

- Keep changes small and focused.
- Prefer editing the existing pipeline and backend code instead of adding duplicate scripts.
- Do not rename folders or files unless the change is intentional and discussed.
- Avoid committing generated data, cached Sentinel outputs, or temporary files.

## Code Style

- Follow the existing style in the surrounding file.
- Keep Python changes readable and minimal.
- Use descriptive names and avoid unnecessary refactors in the same change.
- Preserve the current API behavior unless the task explicitly requires a change.

## Validation

Before opening a pull request, check the relevant part of the app:

- Start the Docker container and verify the backend comes up.
- Reproduce the feature or bug fix you changed.
- Check the terminal output for errors.
- If you touched a Python file, make sure it still runs cleanly in the container.

## Pull Requests

When you open a PR, include:

- A short summary of what changed.
- Why the change was needed.
- How you tested it.
- Any follow-up work or known limitations.

## Good Commit Messages

Examples:

- `Fix Sentinel cache reuse for smaller fields`
- `Update Docker deployment instructions`
- `Improve README and contribution guide`

## Questions or Issues

If you are unsure about a change, open an issue or mention it in the PR description before merging.
