import html
import json
import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, render_template, request

app = Flask(__name__)

SEARCH_PROXY = "https://proxy.freetar.de/search.php"
TAB_PROXY = "https://tabs.proxy.freetar.de/tab/"
REQUEST_TIMEOUT = 15


class BenTarError(Exception):
    pass


@dataclass
class SearchResult:
    artist_name: str
    song_name: str
    tab_url: str
    tab_path: str
    type: str
    version: int
    votes: int
    rating: float


@dataclass
class Song:
    artist_name: str
    song_name: str
    version: int
    type: str
    rating: float
    difficulty: str | None
    capo: int | str | None
    tuning: str | None
    ug_url: str
    tab_html: str


def _extract_store(html_text: str) -> dict:
    soup = BeautifulSoup(html_text, "html.parser")
    store = soup.find("div", class_="js-store")
    if not store or not store.get("data-content"):
        raise BenTarError("The tab page did not contain readable song data.")
    try:
        return json.loads(store["data-content"])
    except (TypeError, json.JSONDecodeError) as exc:
        raise BenTarError("The tab data could not be decoded.") from exc


def _chord_markup(match: re.Match) -> str:
    chord = html.escape(match.group(1))
    if "/" in chord:
        main, bass = chord.split("/", 1)
    else:
        main, bass = chord, None

    root_match = re.match(r"^([A-G](?:#|b)?)(.*)$", main)
    if not root_match:
        return f'<span class="chord">{chord}</span>'

    root, quality = root_match.groups()
    result = f'<span class="chord"><span class="chord-root">{root}</span><span class="chord-quality">{quality}</span>'
    if bass:
        result += f'/<span class="chord-root chord-bass">{bass}</span>'
    result += "</span>"
    return result


def _format_tab(raw: str) -> str:
    # UG/Freetar content has appeared both with literal \n sequences and real newlines,
    # so normalize both forms before rendering.
    escaped = html.escape(raw)
    escaped = re.sub(r"\[ch\](.*?)\[/ch\]", _chord_markup, escaped, flags=re.IGNORECASE)
    escaped = escaped.replace("[tab]", "").replace("[/tab]", "")
    escaped = escaped.replace("\\r\\n", "\n").replace("\\n", "\n")
    escaped = escaped.replace("\r\n", "\n").replace("\r", "\n")
    escaped = escaped.replace(" ", "&nbsp;").replace("\n", "<br>")
    return escaped


def fetch_song(tab_path: str) -> Song:
    tab_path = tab_path.lstrip("/")
    try:
        response = requests.get(TAB_PROXY + tab_path, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise BenTarError("Could not load that tab from the Freetar proxy.") from exc

    data = _extract_store(response.text)
    try:
        page = data["store"]["page"]["data"]
        tab = page["tab"]
        tab_view = page["tab_view"]
        wiki = tab_view["wiki_tab"]
        meta = tab_view.get("meta") or {}

        tuning_data = meta.get("tuning") if isinstance(meta, dict) else None
        tuning = None
        if isinstance(tuning_data, dict):
            value = tuning_data.get("value")
            name = tuning_data.get("name")
            tuning = f"{value} ({name})" if value and name else value or name

        return Song(
            artist_name=tab.get("artist_name", "Unknown artist"),
            song_name=tab.get("song_name", "Unknown song"),
            version=int(tab.get("version") or 1),
            type=tab.get("type", "Tab"),
            rating=float(tab.get("rating") or 0),
            difficulty=tab_view.get("ug_difficulty"),
            capo=meta.get("capo") if isinstance(meta, dict) else None,
            tuning=tuning,
            ug_url=tab.get("tab_url") or f"https://tabs.ultimate-guitar.com/tab/{tab_path}",
            tab_html=_format_tab(wiki.get("content", "")),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise BenTarError("The song loaded, but BenTar could not parse its chord data.") from exc


def search_ug(term: str, page_number: int = 1) -> tuple[list[SearchResult], int, int]:
    params = {
        "page": page_number,
        "search_type": "title",
        "value": term,
    }
    try:
        response = requests.get(SEARCH_PROXY, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise BenTarError(f"Could not search for '{term}'.") from exc

    data = _extract_store(response.text)
    try:
        payload = data["store"]["page"]["data"]
        pagination = payload.get("pagination") or {}
        results = []
        for item in payload.get("results", []):
            tab_type = item.get("type")
            if tab_type in ("Official", "Pro") or not item.get("tab_url"):
                continue
            path = urlparse(item["tab_url"]).path
            if path.startswith("/tab/"):
                tab_path = path[len("/tab/") :]
            else:
                tab_path = path.lstrip("/")
            results.append(
                SearchResult(
                    artist_name=item.get("artist_name", "Unknown artist"),
                    song_name=item.get("song_name", "Unknown song"),
                    tab_url=path,
                    tab_path=tab_path,
                    type=tab_type or "Tab",
                    version=int(item.get("version") or 1),
                    votes=int(item.get("votes") or 0),
                    rating=round(float(item.get("rating") or 0), 1),
                )
            )
        return results, int(pagination.get("total") or 1), int(pagination.get("current") or page_number)
    except (KeyError, TypeError, ValueError) as exc:
        raise BenTarError("Search results could not be parsed.") from exc


@app.route("/")
def index():
    return render_template("index.html", title="BenTar")


@app.route("/search")
def search():
    term = (request.args.get("search_term") or "").strip()
    try:
        page_number = max(1, int(request.args.get("page", "1")))
    except ValueError:
        page_number = 1

    if not term:
        return render_template("index.html", title="BenTar")

    try:
        results, total_pages, current_page = search_ug(term, page_number)
        return render_template(
            "index.html",
            title=f"BenTar - {term}",
            search_term=term,
            search_results=results,
            total_pages=total_pages,
            current_page=current_page,
        )
    except BenTarError as exc:
        return render_template("error.html", title="BenTar error", error=str(exc)), 502


@app.route("/tab/<path:tab_path>")
def tab(tab_path: str):
    try:
        song = fetch_song(tab_path)
        return render_template(
            "tab.html",
            title=f"{song.artist_name} - {song.song_name}",
            song=song,
            tab_path=tab_path,
        )
    except BenTarError as exc:
        return render_template("error.html", title="BenTar error", error=str(exc)), 502


@app.route("/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    port = int(os.getenv("PORT", os.getenv("FREETAR_PORT", "22000")))
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG") == "1")
