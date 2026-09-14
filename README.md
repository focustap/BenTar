# BenTar

BenTar is a lightweight Freetar/Ultimate Guitar chord reader being built for Ben's Meta glasses.

## What works

- Loads Ben's saved Ultimate Guitar library automatically from JSON files committed in `static/library/`
- Uses the same saved library on every browser/device, including the glasses — no per-device upload or account required
- Search/filter saved songs by artist or title
- Open saved Ultimate Guitar/Freetar tab paths inside BenTar
- Fetch and parse chord pages through Freetar's public proxy endpoints
- Show capo, tuning, difficulty, chord text, transpose controls, font-size controls, and autoscroll
- Search Freetar/Ultimate Guitar for other tabs

## Library storage

The favorites list is version-controlled directly in this GitHub repository. `static/library/manifest.json` lists the library chunks that the web app loads on startup.

Because this repository is public, the saved-song list is public too. It contains tab metadata/URLs only — no Ultimate Guitar password, cookie, session, or account token is stored.

To update the library later, export a fresh `freetar-favorites.json` and replace/regenerate the JSON files in `static/library/`. Every device will receive the updated library when it reloads the deployed app.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:22000`.

## Deploy

BenTar is a Flask app and can be deployed on Render, Railway, Fly.io, or another Python host. A public HTTPS deployment can then be registered as a Meta glasses web app. If the host is connected to this GitHub repository with automatic deploys enabled, library updates committed here will propagate without a database.

## Credits / license

BenTar is based on the workflow and proxy approach used by the open-source Freetar project: https://github.com/kmille/freetar

Freetar is GPL-3.0 licensed; BenTar keeps that license in this repository.
