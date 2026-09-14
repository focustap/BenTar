# BenTar

BenTar is a static guitar-tab web app for Ben's saved Ultimate Guitar/Freetar favorites.

## Live site

https://focustap.github.io/BenTar/

BenTar is hosted directly by GitHub Pages from this repository. There is no database and no separate app server.

## How the library works

- The saved favorites live in `static/library/` in this repo.
- `manifest.json` lists the library chunks.
- Every browser — desktop, phone, or Meta glasses — loads the same GitHub-hosted library.
- To update the library later, replace the JSON chunks/manifest in the repo.

## Chord cache

GitHub Pages cannot run Python for a live request, so BenTar uses GitHub Actions to prebuild a static cache instead.

- `scripts/cache_tabs.py` reads every saved tab URL from the library.
- `.github/workflows/cache-tabs.yml` runs the script whenever the saved library or cache script changes.
- The action requests each saved tab from Freetar and writes static chord data under `static/chords/`.
- `static/cache-interceptor.js` redirects BenTar's normal tab request to the matching GitHub-hosted cached file.
- The browser no longer needs a successful cross-origin request to the Freetar proxy when opening a cached song.

The public cache keeps chord placement, chord names, section labels, capo, tuning, difficulty, and song metadata. It does not copy lyric text into the public repository.

## App

The GitHub Pages entry point is `index.html`.

The static app can:

- Load and search the saved library
- Open prebuilt saved chord data from GitHub Pages
- Render capo/tuning/difficulty when available
- Transpose chords
- Change chord-sheet font size
- Autoscroll
- Fall back to opening the same song on freetar.de when a cached song is unavailable
- Use a compact layout for the Meta glasses display

No Ultimate Guitar username or password is stored by BenTar.

## Attribution

BenTar uses the public proxy/workflow of the open-source Freetar project:
https://github.com/kmille/freetar

Freetar is GPL-3.0 licensed; BenTar keeps the same license in this repository.
