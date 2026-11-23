"""Discover candidate song titles from public metadata and resolve them in Neko."""

from collections import Counter
from functools import lru_cache
import re
from time import monotonic

import requests

from phone_music import _search, _session


@lru_cache(maxsize=48)
def _title_hints(query, proxy, period, search_type):
    with _session(proxy) as session:
        response = session.get("https://music.163.com/api/search/get/web",
                               params={"s": query, "type": search_type, "limit": 15, "offset": 0},
                               headers={"Referer": "https://music.163.com/"},
                               timeout=(3, 6))
        response.raise_for_status()
        body = response.json()
    result = body.get("result") if isinstance(body, dict) else None
    rows = result.get("songs") if isinstance(result, dict) else None
    if not isinstance(rows, list):
        return ()
    titles = Counter()
    for row in rows[:15]:
        name = row.get("name") if isinstance(row, dict) else None
        if isinstance(name, str):
            # A cover can identify the composition. Each Neko recording must
            # still pass its own lyric check before it is shown as a result.
            base = re.split(r"[（(【\[]", name, maxsplit=1)[0].strip()
            if 0 < len(base) <= 120:
                titles[base] += 1
    return tuple(title for title, _ in titles.most_common(3))


def find_tracks(query, proxy, limit, search_type=1006):
    period = int(monotonic()) // 300
    try:
        titles = _title_hints(query, proxy, period, search_type)
    except (requests.RequestException, ValueError):
        return []
    rows, seen = [], set()
    for title in titles:
        try:
            matches = _search(title, proxy, period)
        except (requests.RequestException, ValueError):
            continue
        # Titles supplied by the discovery source are hints, not proof of a
        # recording or artist match. Prefer the unqualified title first.
        tracks = [row for row in matches if isinstance(row, dict) and row.get("id")]
        tracks.sort(key=lambda track: track.get("title") != title)
        for track in tracks[:8]:
            if track["id"] not in seen:
                seen.add(track["id"])
                rows.append(track)
                if len(rows) >= limit:
                    return rows
    return rows
