"""Android catalogue and media access through the public Neko Music API."""

import json
import logging
import os
import re
import threading
import time
import unicodedata
from datetime import date
from functools import lru_cache
from hashlib import sha256
from urllib.parse import parse_qs, urljoin, urlsplit

import requests


ORIGIN = "https://music.nekocore.cn"
TRACK_ID = re.compile(r"neko-([1-9][0-9]{0,14})")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
LEGACY_ID = re.compile(r"[A-Za-z0-9_-]{11}")
TIME_TAG = re.compile(r"(?m)^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]")
RECOMMENDATIONS_LOCK = threading.Lock()


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _limit(value, default, maximum):
    try:
        return max(1, min(int(value), maximum))
    except (TypeError, ValueError):
        return default


def _track_number(track_id):
    match = TRACK_ID.fullmatch(track_id or "")
    if not match:
        raise ValueError("无效的曲目标识")
    return match[1]


def _session(proxy):
    session = requests.Session()
    session.trust_env = False
    session.headers["User-Agent"] = "DouyinMusicAndroid/2.2"
    if proxy:
        session.proxies.update({"http": proxy, "https": proxy})
    return session


def _request(path, proxy, *, payload=None, params=None):
    with _session(proxy) as session:
        if payload is not None:
            response = session.post(ORIGIN + path, json=payload, timeout=(7, 12))
        else:
            response = session.get(ORIGIN + path, params=params, timeout=(7, 16))
        response.raise_for_status()
        body = response.json()
    if not isinstance(body, dict):
        raise ValueError("音源响应格式无效")
    return body


def _track_items(source, limit):
    items = []
    seen = set()
    for raw in source:
        if not isinstance(raw, dict):
            continue
        track_id = f"neko-{raw.get('id')}"
        if not TRACK_ID.fullmatch(track_id) or track_id in seen:
            continue
        title, artist = raw.get("title"), raw.get("artist")
        if not isinstance(title, str) or not title.strip() or not isinstance(artist, str) or not artist.strip():
            continue
        seconds = raw.get("duration")
        duration = ""
        if type(seconds) is int and seconds > 0:
            minutes, remainder = divmod(seconds, 60)
            duration = f"{minutes}:{remainder:02d}"
        album = raw.get("album")
        items.append({
            "id": track_id,
            "title": title,
            "channel": artist,
            "album": album if isinstance(album, str) else "",
            "duration": duration,
            "thumbnail": f"{ORIGIN}/api/music/cover/{_track_number(track_id)}",
            "rank": len(items) + 1,
            "resultType": "song",
        })
        seen.add(track_id)
        if len(items) == limit:
            break
    return items


@lru_cache(maxsize=48)
def _search(query, proxy, cache_period):
    response = _request("/api/music/search", proxy, payload={"query": query})
    if response.get("success") is False and "results" in response and response["results"] is None:
        return []
    results = response.get("results")
    if response.get("success") is not True or not isinstance(results, list):
        raise ValueError("搜索结果格式无效")
    return results


def _monthly_recommendations(year, month, proxy):
    from douyin_trends import fetch_playlist

    with _session(proxy) as session:
        playlist_name, playlist_owner, candidates = fetch_playlist(session, year, month)

    queries = []
    seen = set()
    for title, artist in candidates:
        if not title or not artist or len(title) > 120 or len(artist) > 120:
            continue
        key = _name(title), _name(artist)
        if key not in seen:
            seen.add(key)
            queries.append({"title": title, "artist": artist})
        if len(queries) == 75:
            break
    if not queries:
        raise ValueError("榜单中没有可识别的歌曲")

    results = []
    for offset in range(0, len(queries), 25):
        batch = queries[offset:offset + 25]
        response = _request("/api/music/search", proxy, payload={"items": batch})
        tracks = response.get("results")
        if not isinstance(tracks, list) or len(tracks) != len(batch):
            raise ValueError("曲库批量搜索结果格式无效")
        for item, track in zip(batch, tracks):
            if not isinstance(track, dict):
                continue
            title, artist = track.get("title"), track.get("artist")
            if (isinstance(title, str) and isinstance(artist, str)
                    and _name(item["title"]) == _name(title)
                    and _name(item["artist"]) == _name(artist)):
                results.append(track)
        if len(results) >= 20:
            break
    return {
        "source": f"汽水音乐 · {playlist_name}" + (f" · {playlist_owner}" if playlist_owner else ""),
        "results": _track_items(results, 20),
    }


def _daily_recommendations(day, proxy, cache_dir, refresh):
    if not cache_dir:
        return _monthly_recommendations(day.year, day.month, proxy)
    cache_path = os.path.join(cache_dir, "douyin-recommendations.json")
    temp_path = cache_path + ".tmp"
    key = [day.isoformat(), sha256(proxy.encode("utf-8")).hexdigest(), "qishui-single-playlist"]
    with RECOMMENDATIONS_LOCK:
        if refresh:
            try:
                os.remove(cache_path)
            except FileNotFoundError:
                pass
        else:
            try:
                with open(cache_path, encoding="utf-8") as handle:
                    cached = json.load(handle)
                if isinstance(cached, dict) and cached.get("key") == key:
                    data = cached.get("data")
                    if (isinstance(data, dict) and isinstance(data.get("source"), str)
                            and isinstance(data.get("results"), list)):
                        return data
            except (OSError, ValueError):
                pass
        results = _monthly_recommendations(day.year, day.month, proxy)
        try:
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump({"key": key, "data": results}, handle, ensure_ascii=False)
            os.replace(temp_path, cache_path)
        except OSError:
            logging.warning("Cannot cache monthly recommendations")
        return results


@lru_cache(maxsize=48)
def _lyrics(track_number, proxy, cache_period):
    response = _request(f"/api/music/info/{track_number}", proxy)
    data = response.get("data")
    if response.get("success") is not True or not isinstance(data, dict):
        raise ValueError("歌曲详情格式无效")
    text = data.get("lyrics")
    text = text.strip()[:200000] if isinstance(text, str) else ""
    has_timing = bool(TIME_TAG.search(text))
    return {
        "found": bool(text),
        "instrumental": False,
        "trackName": data.get("title") or "",
        "artistName": data.get("artist") or "",
        "syncedLyrics": text if has_timing else "",
        "plainLyrics": text if not has_timing else "",
    }


def api(path, query_string, proxy_url="", device_date="", cache_dir=""):
    params = {key: values[0] for key, values in parse_qs(query_string or "", max_num_fields=12).items()}
    period = int(time.monotonic()) // 300
    try:
        if path == "/health":
            return _json({"ok": True})
        if path == "/api/search":
            query = params.get("q", "").strip()
            if len(query) > 120 or CONTROL.search(query):
                raise ValueError("搜索词过长或含有无效字符")
            raw_tracks = _search(query, proxy_url, period) if query else []
            return _json({"query": query, "results": _track_items(raw_tracks, _limit(params.get("limit"), 20, 50))})
        if path == "/api/playlist":
            today = date.fromisoformat(device_date) if device_date else date.today()
            year, month = today.year, today.month
            title = f"{year}年{month}月抖音热曲"
            try:
                recommendations = _daily_recommendations(today, proxy_url, cache_dir, params.get("refresh") == "1")
            except (OSError, ValueError, requests.RequestException) as error:
                logging.warning("Monthly trends unavailable for %s-%s: %s", year, month, type(error).__name__)
                return _json({"title": title, "results": [], "message": "暂时无法找到合适的汽水音乐歌单，请稍后重试"})
            tracks = recommendations["results"]
            return _json({
                "title": title,
                "source": recommendations["source"],
                "results": tracks[:_limit(params.get("n"), 20, 20)],
                "message": "" if tracks else "所选歌单暂未在 Neko 曲库中匹配到原版",
            })
        if path == "/api/lyrics":
            track_number = _track_number(params.get("id"))
            return _json(_lyrics(track_number, proxy_url, period))
    except requests.RequestException as error:
        logging.warning("Neko API request failed for %s: %s", path, type(error).__name__)
        raise RuntimeError("无法获取音乐数据，请检查网络后重试") from error
    raise ValueError("未知的音乐请求")


def _resolve(track_number, proxy_url):
    try:
        response = _request(f"/api/music/file/{track_number}", proxy_url, params={"quality": "standard"})
        data = response.get("data")
        media_path = data.get("url") if isinstance(data, dict) else None
        if response.get("success") is not True or not isinstance(media_path, str):
            raise ValueError("没有可播放音频")
        url = urljoin(ORIGIN, media_path)
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "music.nekocore.cn" or not parsed.path.startswith("/media/music/"):
            raise ValueError("音频地址格式无效")
        return {"url": url, "headers": {}}
    except (requests.RequestException, ValueError) as error:
        raise RuntimeError("这首歌的音源暂时不可用") from error


def _name(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _resolve_saved_track(title, artist, proxy_url):
    if not isinstance(title, str) or not isinstance(artist, str):
        raise RuntimeError("旧收藏缺少歌名或歌手")
    title, artist = title.strip(), artist.strip()
    query = f"{title} {artist}"
    if not title or not artist or len(query) > 120 or CONTROL.search(query):
        raise RuntimeError("旧收藏缺少有效的歌名或歌手")
    try:
        results = _search(query, proxy_url, int(time.monotonic()) // 300)
    except (requests.RequestException, ValueError) as error:
        raise RuntimeError("暂时无法查找旧收藏的音源") from error
    matches = [
        song for song in _track_items(results, 50)
        if _name(song["title"]) == _name(title) and _name(song["channel"]) == _name(artist)
    ]
    if len(matches) != 1:
        raise RuntimeError("无法确定旧收藏的原唱版本，请重新搜索")
    return _resolve(_track_number(matches[0]["id"]), proxy_url)


def playback_url(track_id, proxy_url="", title="", artist=""):
    from audio_gateway import register
    if LEGACY_ID.fullmatch(track_id or "") and not TRACK_ID.fullmatch(track_id):
        return register(lambda: _resolve_saved_track(title, artist, proxy_url), lambda: _session(proxy_url))
    track_number = _track_number(track_id)
    return register(lambda: _resolve(track_number, proxy_url), lambda: _session(proxy_url))
