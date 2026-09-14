# BenTar

BenTar is a lightweight guitar-tab web app for importing Freetar/Ultimate Guitar favorites JSON and opening the saved songs in a clean chord reader.

## What works

- Import a `freetar-favorites.json` file in the browser
- Keep favorites in browser `localStorage`
- Search/filter imported songs by artist or title
- Open saved Ultimate Guitar/Freetar tab paths inside BenTar
- Fetch and parse chord pages through Freetar's public proxy endpoints
- Show capo, tuning, difficulty, chord text, transpose controls, and autoscroll
- Responsive UI intended to be simplified further for Meta glasses

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:22000`.

## Deploy

BenTar is a normal Flask app and can be deployed on Render/Railway/Fly.io or any host that can run Python. A public HTTPS deployment can later be registered as a Meta glasses web app.

## Notes

The imported favorites file stays in the browser unless you choose to host or modify the app to sync it elsewhere. BenTar does not ask for an Ultimate Guitar username or password.

BenTar is based on the workflow and proxy approach used by the open-source Freetar project: https://github.com/kmille/freetar
