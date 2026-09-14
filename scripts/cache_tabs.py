import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
LIBRARY_DIR = ROOT / "static" / "library"
OUTPUT_DIR = ROOT / "static" / "chords"
TAB_PROXY = "https://tabs.proxy.freetar.de/tab/"
TIMEOUT = 20
WORKERS = 5
HEADERS = {"User-Agent": "BenTar-cache/1.0 (+https://github.com/focustap/BenTar)"}

SECTION_RE = re.compile(
    r"^\s*\[(?:verse|chorus|bridge|intro|outro|pre[- ]?chorus|post[- ]?chorus|"
    r"interlude|instrumental|solo|refrain|hook|break|tag)(?:[^\]]*)\]\s*$",
    re.IGNORECASE,
)
CHORD_RE = re.compile(r"\[ch\](.*?)\[/ch\]", re.IGNORECASE)


def normalize_tab_path(value: str) -> str:
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        value = urlparse(value).path
    if not value.startswith("/"):
        value = "/" + value
    marker = value.find("/tab/")
    if marker >= 0:
        value = value[marker:]
    return value


def cache_filename(path: str) -> str:
    match = re.search(r"-(\d+)$", path)
    if match:
        return f"{match.group(1)}.json"
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", path.strip("/"))
    return f"{slug}.json"


def extract_store(html_text: str) -> dict:
    soup = BeautifulSoup(html_text, "html.parser")
    store = soup.find("div", class_="js-store")
    if not store or not store.get("data-content"):
        raise RuntimeError("No Freetar/UG song payload found")
    return json.loads(store["data-content"])


def chord_only_content(raw: str) -> str:
    """Keep chord placement + section labels while omitting lyric text."""
    text = str(raw or "")
    text = text.replace("\\r\\n", "\n").replace("\\n", "\n")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("[tab]", "").replace("[/tab]", "")

    output = []
    for line in text.split("\n"):
        matches = list(CHORD_RE.finditer(line))
        if matches:
            # Preserve approximate horizontal chord placement without copying lyrics.
            rendered = []
            visible_pos = 0
            out_pos = 0
            cursor = 0
            for match in matches:
                before = line[cursor:match.start()]
                visible_pos += len(before)
                if visible_pos > out_pos:
                    rendered.append(" " * (visible_pos - out_pos))
                    out_pos = visible_pos
                token = f"[ch]{match.group(1).strip()}[/ch]"
                rendered.append(token)
                out_pos += len(match.group(1).strip())
                cursor = match.end()
            output.append("".join(rendered).rstrip())
        elif SECTION_RE.match(line):
            output.append(line.strip())
        else:
            output.append("")

    # Collapse huge runs of empty lyric-only lines while preserving song sections.
    cleaned = []
    blank_run = 0
    for line in output:
        if line:
            blank_run = 0
            cleaned.append(line)
        else:
            blank_run += 1
            if blank_run <= 2:
                cleaned.append("")
    return "\n".join(cleaned).strip()


def parse_song(html_text: str, path: str) -> dict:
    data = extract_store(html_text)
    page = data["store"]["page"]["data"]
    tab = page["tab"]
    view = page["tab_view"]
    meta = view.get("meta") or {}
    tuning_data = meta.get("tuning") if isinstance(meta, dict) else None
    tuning = None
    if isinstance(tuning_data, dict):
        value = tuning_data.get("value")
        name = tuning_data.get("name")
        tuning = " ".join(part for part in [value, f"({name})" if name else None] if part)

    return {
        "artist": tab.get("artist_name") or "Unknown artist",
        "title": tab.get("song_name") or "Unknown song",
        "version": int(tab.get("version") or 1),
        "difficulty": view.get("ug_difficulty"),
        "capo": meta.get("capo") if isinstance(meta, dict) else None,
        "tuning": tuning,
        "tabUrl": tab.get("tab_url") or path,
        "content": chord_only_content((view.get("wiki_tab") or {}).get("content", "")),
    }


def fetch_song(path: str) -> dict:
    proxy_path = re.sub(r"^/tab/", "", normalize_tab_path(path))
    url = TAB_PROXY + proxy_path
    last_error = None
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=TIMEOUT, headers=HEADERS)
            response.raise_for_status()
            return parse_song(response.text, path)
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last_error))


def load_library() -> dict[str, dict]:
    manifest = json.loads((LIBRARY_DIR / "manifest.json").read_text(encoding="utf-8"))
    library = {}
    for filename in manifest:
        chunk = json.loads((LIBRARY_DIR / filename).read_text(encoding="utf-8"))
        library.update(chunk)
    return library


def main() -> None:
    library = load_library()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    paths = sorted({normalize_tab_path(item.get("tab_url") or key) for key, item in library.items()})
    paths = [path for path in paths if path.startswith("/tab/")]

    manifest = {"songs": {}, "failures": {}, "count": 0}
    print(f"Caching {len(paths)} saved tabs from Freetar...")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        future_map = {pool.submit(fetch_song, path): path for path in paths}
        completed = 0
        for future in as_completed(future_map):
            path = future_map[future]
            completed += 1
            try:
                song = future.result()
                filename = cache_filename(path)
                (OUTPUT_DIR / filename).write_text(
                    json.dumps(song, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                manifest["songs"][path] = filename
                print(f"[{completed}/{len(paths)}] OK   {path}")
            except Exception as exc:
                manifest["failures"][path] = str(exc)[:300]
                print(f"[{completed}/{len(paths)}] FAIL {path}: {exc}")

    manifest["count"] = len(manifest["songs"])
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(f"Cached {manifest['count']}/{len(paths)} tabs; {len(manifest['failures'])} failed.")
    if manifest["count"] == 0:
        raise SystemExit("No tabs could be cached")


if __name__ == "__main__":
    main()
