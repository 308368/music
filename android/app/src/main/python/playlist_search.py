"""Search public playlist metadata one provider at a time, play through Neko."""

import base64
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from html import unescape
import json
import re
import unicodedata
from urllib.parse import parse_qs, unquote, urlsplit

import phone_music as music
from douyin_trends import BING_LINK, _detail as qishui_detail, _get, _playlist_ids


HOSTS = {"netease": "music.163.com", "qq": "y.qq.com", "qishui": "music.douyin.com"}
ID = re.compile(r"[1-9][0-9]{0,19}")
VERSION = re.compile(r"(?<![a-z])(live|remix|acoustic|instrumental|demo|dj)(?![a-z])|现场|伴奏|翻唱|不插电|重制", re.I)


def _key(text):
    return "".join(unicodedata.normalize("NFKC", str(text or "")).casefold().split())


def _score(query, title):
    needle, name = _key(query), _key(title)
    if not needle or not name:
        return 0
    if needle == name:
        return 100
    if needle in name:
        return 80 + round(15 * len(needle) / len(name))
    match = SequenceMatcher(None, needle, name, autojunk=False)
    covered = sum(block.size for block in match.get_matching_blocks()) / len(needle)
    if covered < 0.66 or match.find_longest_match().size < 2:
        return 0
    return round(45 * covered + 25 * match.ratio())


def _summary(source, pid, title, owner="", count=None):
    return {"id": str(pid), "name": unescape(str(title or "")).strip(), "source": source,
            "owner": unescape(str(owner or "")).strip(),
            "count": int(count) if str(count).isascii() and str(count).isdigit() else None}


def _json(session, url, params):
    try:
        data = json.loads(_get(session, url, params))
        if isinstance(data, dict):
            return data
    except ValueError:
        pass
    raise ValueError("暂时无法读取平台的公开歌单")


def _link_ids(page, source):
    if source == "qishui":
        yield from _playlist_ids(page)
    text = unquote(unescape(page)).replace(r"\/", "/")
    links = re.findall(r"""https?://[^\s"'<>]+""", text)
    for redirect in BING_LINK.findall(text):
        token = parse_qs(urlsplit(redirect).query).get("u", [""])[0]
        if re.fullmatch(r"a1[\w-]{1,1200}", token):
            try:
                links.append(base64.urlsafe_b64decode(token[2:] + "=" * (-(len(token)-2) % 4)).decode())
            except (ValueError, UnicodeError):
                continue
    for link in links:
        try:
            url = urlsplit(link)
            host, path, query = url.hostname or "", url.path, url.query
            if source == "netease" and host == HOSTS[source]:
                if url.fragment.startswith("/playlist?"):
                    path, query = url.fragment.split("?", 1)
                if path.rstrip("/") not in ("/playlist", "/m/playlist"):
                    continue
                pid = parse_qs(query).get("id", [""])[0]
            elif source == "qq" and (host == "y.qq.com" or host.endswith(".y.qq.com")):
                m = re.search(r"/(?:playlist|playsquare)/(\d+)(?:\.html)?/?$", path)
                if m:
                    pid = m[1]
                elif path.endswith("/taoge.html"):
                    pid = parse_qs(query).get("id", [""])[0]
                else:
                    continue
            elif source == "qishui" and host in ("www.qishui.com", "qishui.com"):
                match = re.fullmatch(r"/playlist/(\d{12,20})/?", path)
                if not match:
                    continue
                pid = match[1]
            else:
                continue
            if ID.fullmatch(pid):
                yield pid
        except ValueError:
            continue


def _row(title, singers, album="", subtitle=""):
    names = [a["name"].strip() for a in singers or []
             if isinstance(a, dict) and isinstance(a.get("name"), str) and a["name"].strip()]
    return {"title": str(title or "").strip(), "channel": " / ".join(names), "track": None,
            "_edition": " ".join(str(part or "") for part in (album, subtitle))}


def _external(session, source, pid, full):
    if source == "qishui":
        data = qishui_detail(session, pid)
        if not data:
            raise ValueError("无法读取汽水音乐公开歌单")
        songs = data["songlist"]
        info = _summary(source, pid, data["name"], data.get("owner"), data.get("songnum", len(songs)))
        rows = [_row(s.get("name"), s.get("singer"), s.get("album")) for s in songs if isinstance(s, dict)] if full else []
    elif source == "netease":
        data = _json(session, "https://music.163.com/api/v6/playlist/detail",
                     {"id": pid, "n": 100 if full else 1}).get("playlist") or {}
        if str(data.get("id")) != pid:
            raise ValueError("无法读取网易云音乐公开歌单")
        info = _summary(source, pid, data["name"], (data.get("creator") or {}).get("nickname"),
                        data.get("trackCount"))
        tracks = {str(s["id"]): s for s in data.get("tracks") or []}
        ids = [str(s["id"]) for s in data.get("trackIds") or []] or list(tracks)
        missing = [i for i in ids if i not in tracks] if full else []
        for start in range(0, len(missing), 100):
            songs = _json(session, "https://music.163.com/api/song/detail",
                          {"ids": json.dumps([int(i) for i in missing[start:start+100]])}).get("songs") or []
            tracks.update((str(s["id"]), s) for s in songs)
        rows = []
        if full:
            for i in ids:
                s = tracks.get(i, {})
                album = s.get("al") or s.get("album") or {}
                rows.append(_row(s.get("name"), s.get("ar") or s.get("artists"), album.get("name")))
    else:
        def read_page(offset):
            args = {"disstid": int(pid), "song_begin": offset, "song_num": 100 if full else 1,
                    "onlysonglist": int(offset > 0), "dirid": 0, "tag": 1}
            rpc = {"req_0": {"module": "music.srfDissInfo.aiDissInfo", "method": "uniform_get_Dissinfo", "param": args}}
            response = _json(session, "https://u.y.qq.com/cgi-bin/musicu.fcg", {"data": json.dumps(rpc)})
            result = response.get("req_0", {})
            if result.get("code") != 0 or not isinstance(result.get("data"), dict):
                raise ValueError("无法读取 QQ 音乐公开歌单")
            return result["data"]

        first = read_page(0)
        directory = first.get("dirinfo") or {}
        if str(directory.get("id")) != pid or not directory.get("title"):
            raise ValueError("无法读取 QQ 音乐公开歌单")
        info = _summary(source, pid, directory["title"], (directory.get("creator") or {}).get("nick"),
                        first.get("total_song_num", directory.get("songnum")))
        tracks = list(first.get("songlist") or []) if full else []
        while full and info["count"] and len(tracks) < info["count"]:
            page = read_page(len(tracks)).get("songlist") or []
            if not page or not tracks or page[0].get("id") == tracks[0].get("id"):
                raise ValueError("QQ 音乐歌单分页未完成，请重试")
            tracks.extend(page)
        rows = [_row(s.get("title") or s.get("name"), s.get("singer"), (s.get("album") or {}).get("name"), s.get("subtitle"))
                for s in tracks]
    return info, rows


def _discover(session, source, query, limit):
    keyword = f"{query} 歌单 site:{HOSTS[source]}"
    endpoints = [("https://m.so.com/s", {"q": keyword}),
                 ("https://cn.bing.com/search", {"q": keyword, "format": "rss"})]
    if source == "qishui":
        endpoints.append(("https://m.so.com/s", {"q": f"{query} 歌单 site:www.qishui.com"}))
    def metadata(pid):
        try:
            return _external(session, source, pid, False)[0]
        except (ValueError, KeyError):
            return None
    with ThreadPoolExecutor(max_workers=4) as pool:
        pages = list(pool.map(lambda args: _get(session, *args), endpoints))
        if not any(pages):
            raise ValueError("暂时无法连接歌单搜索服务")
        ids = dict.fromkeys(pid for page in pages for pid in _link_ids(page, source))
        return [item for item in pool.map(metadata, list(ids)[:max(6, min(12, limit))]) if item]


def _headers(session, source):
    session.headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"
    if source in ("netease", "qq"):
        session.headers["Referer"] = "https://" + HOSTS[source] + "/"


def search(source, query, proxy="", limit=20):
    query = str(query or "").strip()
    if not query:
        return {"results": []}
    if source == "neko":
        data = music._request("/api/playlists/search", proxy, payload={"query": query})
        if data.get("success") is not True and not ("results" in data and data["results"] is None):
            raise ValueError("无法读取 Neko 歌单")
        items = [_summary(source, s["id"], s["name"], (s.get("creator") or {}).get("nickname"), s.get("musicCount"))
                 for s in data.get("results") or []]
    elif source in HOSTS:
        with music._session(proxy) as session:
            _headers(session, source)
            items = []
            if source == "netease":
                try:
                    data = _json(session, "https://music.163.com/api/search/get/web",
                                 {"s": query, "type": 1000, "limit": limit, "offset": 0})
                    items = [_summary(source, s["id"], s["name"], (s.get("creator") or {}).get("nickname"), s.get("trackCount"))
                             for s in (data.get("result") or {}).get("playlists") or []]
                except ValueError:
                    pass
            elif source == "qq":
                try:
                    data = _json(session, "https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist",
                                 {"query": query, "page_no": 0, "num_per_page": limit, "format": "json",
                                  "remoteplace": "txt.yqq.playlist", "inCharset": "utf-8",
                                  "outCharset": "utf-8", "platform": "yqq.json"})
                    items = [_summary(source, s["dissid"], re.sub(r"</?em[^>]*>", "", s["dissname"], flags=re.I),
                                      (s.get("creator") or {}).get("name"), s.get("song_count"))
                             for s in (data.get("data") or {}).get("list") or []
                             if isinstance(s, dict) and s.get("dissid") and s.get("dissname")]
                except ValueError:
                    pass
            if not any(_score(query, item["name"]) for item in items):
                items = _discover(session, source, query, limit)
    else:
        raise ValueError("未知歌单来源")
    ranked = {}
    for item in items:
        item["score"] = _score(query, item["name"])
        if ID.fullmatch(item["id"]) and item["score"]:
            ranked[item["id"]] = item
    return {"results": sorted(ranked.values(), key=lambda item: -item["score"])[:limit]}


def _artist_key(credit):
    return sorted(_key(name) for name in re.split(r"\s*[/、;；]\s*", credit) if name)


def _versions(title, extra):
    return {m.group().casefold() for m in VERSION.finditer(f"{title} {extra}")}


def _match_rows(rows, proxy):
    pending = [row for row in rows if row["title"] and row["channel"]]
    def match(batch):
        queries = [{"title": row["title"], "artist": row["channel"]} for row in batch]
        response = music._request("/api/music/search", proxy, payload={"items": queries})
        candidates = response.get("results")
        if not isinstance(candidates, list) or len(candidates) != len(batch):
            raise ValueError("曲库批量匹配响应不完整，请重试")
        for row, raw in zip(batch, candidates):
            songs = music._track_items([raw], 1)
            if not songs:
                continue
            track = songs[0]
            if (_key(row["title"]) == _key(track["title"])
                    and _artist_key(row["channel"]) == _artist_key(track["channel"])
                    and _versions(row["title"], row.get("_edition", "")) == _versions(track["title"], track["album"])):
                row["track"] = track
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(match, [pending[i:i+25] for i in range(0, len(pending), 25)]))


def detail(source, pid, proxy=""):
    pid = str(pid)
    if not ID.fullmatch(pid):
        raise ValueError("歌单编号无效")
    if source == "neko":
        info = music._request("/api/playlist/" + pid, proxy).get("playlist") or {}
        data = music._request("/api/user/playlist/music/" + pid, proxy)
        if str(info.get("id")) != pid or not isinstance(data.get("musicList"), list):
            raise ValueError("无法读取 Neko 歌单")
        name, rows = info["name"], []
        for raw in data["musicList"]:
            songs = music._track_items([raw], 1)
            rows.append({"title": raw.get("title") or "", "channel": raw.get("artist") or "",
                         "track": songs[0] if songs else None})
    elif source in HOSTS:
        with music._session(proxy) as session:
            _headers(session, source)
            info, rows = _external(session, source, pid, True)
        name = info["name"]
        _match_rows(rows, proxy)
    else:
        raise ValueError("未知歌单来源")
    for row in rows:
        row.pop("_edition", None)
        if not row["title"]:
            row["title"] = "曲目名称不可用"
    return {"name": name, "source": source, "results": rows}
