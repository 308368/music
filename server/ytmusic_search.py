"""Search the public YouTube Music catalogue and emit normalized songs as JSON."""

from __future__ import annotations

import base64
import json
import os
import sys

from ytmusicapi import YTMusic


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    query = base64.b64decode(sys.argv[1]).decode("utf-8").strip()
    limit = max(1, min(int(sys.argv[2]), 50))
    proxy = (
        os.environ.get("YTDLP_PROXY")
        or os.environ.get("HTTPS_PROXY")
        or os.environ.get("HTTP_PROXY")
        or ""
    ).strip()
    proxies = {"http": proxy, "https": proxy} if proxy else None
    raw_results = YTMusic(proxies=proxies).search(
        query, filter="songs", limit=limit, ignore_spelling=False
    )

    songs: list[dict] = []
    seen: set[str] = set()
    for result in raw_results:
        video_id = result.get("videoId")
        duration_seconds = result.get("duration_seconds")
        if (
            result.get("resultType") != "song"
            or not result.get("isAvailable", True)
            or not isinstance(video_id, str)
            or video_id in seen
            or (isinstance(duration_seconds, int) and duration_seconds > 1800)
        ):
            continue
        artists = [
            artist.get("name", "").strip()
            for artist in result.get("artists") or []
            if isinstance(artist, dict) and artist.get("name")
        ]
        songs.append(
            {
                "id": video_id,
                "title": str(result.get("title") or "未知歌曲"),
                "channel": " / ".join(artists) or "未知歌手",
                "duration": str(result.get("duration") or ""),
                "album": (result.get("album") or {}).get("name") or "",
                "resultType": "song",
            }
        )
        seen.add(video_id)
        if len(songs) >= limit:
            break

    print(json.dumps(songs, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
