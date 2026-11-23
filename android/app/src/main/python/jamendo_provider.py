"""Official Jamendo API source for the personal Android music player.

The client ID is supplied by the user in Android network settings; no API
credentials are embedded in the APK or this repository.
"""
import re
import time
from functools import lru_cache
from urllib.parse import urlsplit

import requests

import phone_music as music

API = "https://api.jamendo.com/v3.0/tracks/"
TRACK_ID = re.compile(r"jamendo-([1-9][0-9]{0,14})\Z")
CLIENT_ID = re.compile(r"[A-Za-z0-9]{8,64}\Z")


def is_track_id(value):
    return bool(TRACK_ID.fullmatch(value or ""))


def _number(track_id):
    match = TRACK_ID.fullmatch(track_id or "")
    if not match:
        raise ValueError("无效的 Jamendo 曲目标识")
    return match[1]


def _request(client_id, proxy, **query):
    if not CLIENT_ID.fullmatch(client_id or ""):
        raise ValueError("请在网络设置中填写有效的 Jamendo Client ID")
    params = {"client_id": client_id, "format": "json", "type": "single albumtrack",
              **query}
    with music._session(proxy) as session:
        response = session.get(API, params=params, timeout=(7, 16))
        response.raise_for_status()
        body = response.json()
    if (not isinstance(body, dict) or not isinstance(body.get("headers"), dict)
            or body["headers"].get("status") != "success"
            or not isinstance(body.get("results"), list)):
        raise ValueError("Jamendo API 返回异常")
    return body["results"]


def _image(raw):
    url = raw.get("image")
    if not isinstance(url, str):
        return ""
    parsed = urlsplit(url)
    if (parsed.scheme == "https" and parsed.hostname == "usercontent.jamendo.com"
            and parsed.port is None and not parsed.username and not parsed.password
            and parsed.path in ("", "/")):
        return url
    return ""


def _track(raw):
    if not isinstance(raw, dict):
        return None
    number = str(raw.get("id") or "")
    title, artist = raw.get("name"), raw.get("artist_name")
    if (not number.isdecimal() or not number.startswith(tuple("123456789"))
            or len(number) > 15 or not isinstance(title, str)
            or not title.strip() or not isinstance(artist, str) or not artist.strip()):
        return None
    seconds = raw.get("duration")
    duration = ""
    if type(seconds) is int and seconds > 0:
        minutes, remainder = divmod(seconds, 60)
        duration = f"{minutes}:{remainder:02d}"
    album = raw.get("album_name")
    album = album.strip() if isinstance(album, str) else ""
    license_url = raw.get("license_ccurl")
    if not isinstance(license_url, str) or not license_url.startswith(("http://creativecommons.org/", "https://creativecommons.org/")):
        license_url = ""
    return {
        "id": f"jamendo-{number}",
        "title": title.strip(),
        "channel": artist.strip(),
        "album": ("Jamendo · " + album) if album else "Jamendo",
        "duration": duration,
        "thumbnail": _image(raw),
        "source": "jamendo",
        "licenseUrl": license_url,
        "trackUrl": f"https://www.jamendo.com/track/{number}",
        "resultType": "song",
    }


@lru_cache(maxsize=96)
def _cached_search(query, proxy, client_id, limit, period):
    rows = _request(client_id, proxy, search=query, limit=limit,
                    audioformat="mp32", order="relevance")
    return [item for row in rows if (item := _track(row)) is not None]


def search(query, proxy, client_id, limit=20):
    if not client_id:
        return []
    if not isinstance(query, str) or not query.strip() or len(query) > 120:
        return []
    limit = max(1, min(int(limit), 50))
    return [dict(row) for row in _cached_search(
        query, proxy, client_id, limit, int(time.monotonic()) // 300)][:limit]


def _detail(track_id, proxy, client_id, *, include=""):
    number = _number(track_id)
    params = {"id": number, "audioformat": "mp32"}
    if include:
        params["include"] = include
    rows = _request(client_id, proxy, **params)
    if len(rows) != 1 or str(rows[0].get("id")) != number:
        raise ValueError("Jamendo 曲目不存在或无法访问")
    return rows[0]


def resolve(track_id, proxy, client_id):
    try:
        row = _detail(track_id, proxy, client_id)
        url = row.get("audio")
        if not isinstance(url, str) or len(url) > 2048:
            raise ValueError("歌曲没有可播放的音频")
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        if (parsed.scheme != "https" or not host.endswith(".storage.jamendo.com")
                or host == ".storage.jamendo.com" or parsed.port is not None
                or parsed.username is not None or parsed.password is not None
                or parsed.fragment):
            raise ValueError("不受信任的 Jamendo 音频地址")
        return {"url": url, "headers": {}}
    except (requests.RequestException, ValueError) as error:
        raise RuntimeError("这首 Jamendo 歌曲暂时无法播放") from error


def lyrics(track_id, proxy, client_id):
    row = _detail(track_id, proxy, client_id, include="lyrics")
    raw = row.get("lyrics")
    if isinstance(raw, dict):
        raw = raw.get("text") or raw.get("lyrics") or ""
    body = raw.strip()[:200000] if isinstance(raw, str) else ""
    timed = bool(music.TIME_TAG.search(body))
    return {
        "found": bool(body), "instrumental": False,
        "trackName": row.get("name") or "", "artistName": row.get("artist_name") or "",
        "syncedLyrics": body if timed else "",
        "plainLyrics": "" if timed else body,
    }
