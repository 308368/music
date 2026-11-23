"""Find a single matching public Qishui Music playlist for the home screen."""

import base64
import json
import re
from time import monotonic
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from urllib.parse import parse_qs, unquote, urlsplit

import requests

from qishui_ranking import match_score


METADATA_URL = "https://music.nekocore.cn/loser/qishui/getSongListDetail"
SHARE_URL = "https://music.douyin.com/qishui/share/playlist"
PLAYLIST_ID = re.compile(r"[0-9]{12,20}")
PUBLIC_LINK = re.compile(r"https?://(?:music|m)\.douyin\.com/qishui/(?:share/playlist\?[^\s\"<>]+|playlist/[0-9]+)", re.I)
BING_LINK = re.compile(r'(?:https://(?:cn|www)\.bing\.com)?/ck/a\?[^\s"<>]+')
# Public Qishui shares give discovery a starting point when engines omit playlist links.
# Their live titles are checked against the device date like any search result.
PUBLIC_PLAYLISTS = ("7203983736064622592", "7188047799517904953", "7200303561195061287")


def _playlist_ids(html):
    text = unquote(unescape(html)).replace(r"\/", "/")
    links = PUBLIC_LINK.findall(text)
    for redirect in BING_LINK.findall(text):
        try:
            token = parse_qs(urlsplit(redirect).query).get("u", [""])[0]
            if re.fullmatch(r"a1[A-Za-z0-9_-]{1,1000}", token):
                encoded = token[2:]
                links.append(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode())
        except (ValueError, UnicodeError):
            continue

    for link in links:
        try:
            url = urlsplit(link)
            if url.netloc == "music.douyin.com" and url.path == "/qishui/share/playlist":
                playlist_id = parse_qs(url.query, max_num_fields=20).get("playlist_id", [""])[0]
            elif url.netloc == "m.douyin.com" and url.path.startswith("/qishui/playlist/"):
                playlist_id = url.path.removeprefix("/qishui/playlist/").strip("/")
            else:
                continue
        except ValueError:
            continue
        if url.scheme in ("https", "http") and PLAYLIST_ID.fullmatch(playlist_id):
            yield playlist_id


def _get(session, url, params):
    # Sessions are local to each worker. Reuse only the app's proxy and headers.
    deadline = monotonic() + 9
    try:
        with requests.Session() as client:
            client.trust_env = session.trust_env
            client.headers.update(session.headers)
            client.proxies.update(session.proxies)
            with client.get(url, params=params, allow_redirects=False, stream=True,
                            timeout=(3, 5)) as response:
                if response.status_code != 200:
                    return ""
                data = bytearray()
                for chunk in response.iter_content(32768):
                    data.extend(chunk)
                    if len(data) > 2_500_000 or monotonic() > deadline:
                        return ""
                return data.decode("utf-8", errors="replace")
    except requests.RequestException:
        return ""


def _detail(session, playlist_id):
    try:
        response = json.loads(_get(session, METADATA_URL, {"playlist_id": playlist_id}))
        data = response.get("data")
        if response.get("success") is True and isinstance(data, dict):
            if str(data.get("playlist_id")) == playlist_id and data.get("songlist") and isinstance(data["songlist"], list):
                return data
    except (ValueError, AttributeError):
        pass
    return _share_detail(session, playlist_id)


def _share_detail(session, playlist_id):
    html = _get(session, SHARE_URL, {"playlist_id": playlist_id})
    marker = re.search(r"\b_ROUTER_DATA\s*=\s*(?=\{)", html)
    if not marker:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(html, marker.end())
        page = data["loaderData"]["playlist_page"]
        info = page["playlistInfo"]
        if str(info["id"]) != playlist_id:
            return None
        owner = info.get("owner") or {}
        songs = []
        for media in page["medias"]:
            track = (media.get("entity") or {}).get("track")
            if isinstance(track, dict):
                songs.append({"name": track.get("name"), "singer": track.get("artists")})
        return {"name": info["title"], "owner": owner.get("nickname"), "songlist": songs}
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _ranked_playlists(details, year, month):
    ranked = []
    for detail in details:
        if not detail or not isinstance(detail.get("name"), str) or not detail["songlist"]:
            continue
        score = match_score(detail["name"], year, month)
        if score is not None:
            ranked.append((score, detail))
    return sorted(ranked, key=lambda entry: entry[0], reverse=True)


def _songs(detail):
    for entry in detail["songlist"]:
        if not isinstance(entry, dict):
            continue
        title, singers = entry.get("name"), entry.get("singer")
        if not isinstance(title, str) or not isinstance(singers, list):
            continue
        artists = [singer["name"].strip() for singer in singers
                   if isinstance(singer, dict) and isinstance(singer.get("name"), str) and singer["name"].strip()]
        if title.strip() and artists:
            yield title.strip(), " / ".join(artists)


def fetch_playlist(session, year, month):
    monthly = f"{year}年{month}月 抖音热歌 汽水音乐 歌单"
    yearly = f"汽水音乐 {year} 抖音热歌 歌单 site:music.douyin.com"
    searches = [
        ("https://www.so.com/s", {"q": monthly + " site:music.douyin.com"}),
        ("https://www.so.com/s", {"q": yearly}),
        ("https://www.so.com/s", {"q": f"site:music.douyin.com {year} 抖音热歌"}),
        ("https://cn.bing.com/search", {"q": monthly + " site:music.douyin.com", "format": "rss"}),
    ]
    with ThreadPoolExecutor(max_workers=6) as pool:
        pages = pool.map(lambda search: _get(session, *search), searches)
        discovered = list(dict.fromkeys(pid for page in pages for pid in _playlist_ids(page)))[:6]
        ids = list(dict.fromkeys([*discovered, *PUBLIC_PLAYLISTS]))
        details = pool.map(lambda playlist_id: _detail(session, playlist_id), ids)
        for _, detail in _ranked_playlists(details, year, month):
            tracks = list(_songs(detail))
            if tracks:
                owner = detail.get("owner")
                return detail["name"], owner if isinstance(owner, str) else "", tracks
    raise ValueError("未找到符合当前年月的汽水音乐歌单")
