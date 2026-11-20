"""External E2E: health -> playlist -> search -> stream -> ranged proxy."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import traceback
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "artifacts" / "e2e"
BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")
QUERY = os.environ.get("E2E_QUERY", "晴天 周杰伦")


def get(path: str, timeout: int = 60) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as response:
        if response.status != 200:
            raise AssertionError(f"GET {path} returned HTTP {response.status}")
        return json.load(response)


def ranged_probe(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Range": "bytes=0-30000"})
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = response.read(30001)
        result = {
            "status": response.status,
            "content_type": response.headers.get_content_type(),
            "content_range": response.headers.get("Content-Range"),
            "accept_ranges": response.headers.get("Accept-Ranges"),
            "bytes_got": len(payload),
        }
    if result["status"] not in (200, 206):
        raise AssertionError(f"proxy returned HTTP {result['status']}")
    if not result["content_type"].startswith("audio/"):
        raise AssertionError(f"proxy returned {result['content_type']}, expected audio/*")
    if result["bytes_got"] == 0:
        raise AssertionError("proxy returned an empty body")
    return result


def write_json(name: str, value: object) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / name).write_text(
        json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def run() -> dict:
    report: dict = {"base": BASE, "query": QUERY}
    health = get("/health", timeout=10)
    if health.get("ok") is not True:
        raise AssertionError("health endpoint did not report ok=true")
    report["health"] = health

    playlist = get("/api/playlist?n=4", timeout=150)
    playlist_items = playlist.get("results") or []
    if not playlist_items:
        raise AssertionError("playlist returned no results")
    report["playlist_count"] = len(playlist_items)
    report["playlist_first_has_thumb"] = bool(playlist_items[0].get("thumbnail"))
    write_json("playlist_result.json", playlist)

    search = get(
        "/api/search?q=" + urllib.parse.quote(QUERY) + "&limit=3", timeout=90
    )
    search_items = search.get("results") or []
    if not search_items or not search_items[0].get("id"):
        raise AssertionError("search returned no playable result")
    if any(item.get("resultType") != "song" for item in search_items):
        raise AssertionError("search returned a non-song result")
    first = search_items[0]
    report["search_count"] = len(search_items)
    report["first_id"] = first["id"]
    write_json("search_result.json", search)

    stream = get(
        "/api/stream?id=" + urllib.parse.quote(first["id"]), timeout=90
    )
    if not stream.get("url") or not stream.get("mime"):
        raise AssertionError("stream response is missing url or mime")
    report["stream_mime"] = stream["mime"]

    proxy_url = f"{BASE}/api/proxy?id=" + urllib.parse.quote(first["id"])
    report["proxy"] = ranged_probe(proxy_url)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "stream_url.txt").write_text(proxy_url, encoding="utf-8")
    return report


def main() -> int:
    try:
        report = run()
        report["ok"] = True
        exit_code = 0
    except Exception as error:
        report = {
            "base": BASE,
            "query": QUERY,
            "ok": False,
            "error": str(error)[:500],
            "traceback": traceback.format_exc()[-1200:],
        }
        exit_code = 1

    write_json("e2e_report.json", report)
    print(json.dumps({k: v for k, v in report.items() if k != "traceback"}, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
