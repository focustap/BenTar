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

## App

The GitHub Pages entry point is `index.html`.

The static app can:

- Load and search the saved library
- Open saved songs
- Attempt to load the actual chord sheet through Freetar's public tab proxy directly in the browser
- Render capo/tuning/difficulty when available
- Transpose chords
- Change chord-sheet font size
- Autoscroll
- Fall back to opening the same song on freetar.de if the proxy blocks a browser request
- Use a compact layout for the Meta glasses display

No Ultimate Guitar username or password is stored by BenTar.

## Attribution

BenTar uses the public proxy/workflow of the open-source Freetar project:
https://github.com/kmille/freetar

Freetar is GPL-3.0 licensed; BenTar keeps the same license in this repository.
