# BenTar

BenTar is a static guitar chord-sheet reader for Ben's saved Ultimate Guitar pages.

## Live site

https://focustap.github.io/BenTar/

BenTar is hosted directly by GitHub Pages. There is no database, proxy, or separate app server.

## Library

The original saved Ultimate Guitar HTML pages live in `raw-tabs/`.

The app makes one lightweight GitHub directory request to discover the files, builds the searchable song list from their filenames, and only opens/parses a saved HTML page when that song is selected. The browser reads the chord sheet, capo, tuning, key, difficulty, and original source directly from that saved page.

Duplicate saves of the same song/version are collapsed in the library automatically.

## Reader features

- Search by song or artist
- Clearly displayed capo, tuning, key, and difficulty when present
- Chord transposition from -12 to +12 semitones
- Adjustable font size
- Adjustable autoscroll from extremely slow (0.15 px/s) to fast
- Compact layout suitable for Meta glasses

## Updating the library

Add or replace saved `.html` pages in `raw-tabs/` and push them to GitHub. No generated chunk files, Freetar cache, Python build script, or database is required.
