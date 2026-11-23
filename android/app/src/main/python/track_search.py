"""Category-aware retrieval and conservative typo matching for Android search."""
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import requests

import phone_music as music
from search_pinyin import READINGS

_HAN = {ord(char): syllable for syllable, chars in READINGS.items() for char in chars}
_TAG = re.compile(r"\[(?:\d+:\d+[^\]]*|[a-z]+:[^\]]*)\]|<\d+:\d+[^>]*>", re.I)
_SEPARATORS = re.compile(r"\s*(?:[/／、;,，；]|\s[&＆]\s|\s(?:feat\.?|ft\.?)\s)\s*", re.I)
# Bound network fan-out across concurrent WebView queries, not only within one request.
_POOL = ThreadPoolExecutor(max_workers=8)


def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', value).casefold() if c.isalnum())


@lru_cache(maxsize=2048)
def pinyin(text):
    return text.translate(_HAN)


def _one_edit(a, b):
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    index = next((i for i in range(len(a)) if a[i] != b[i]), len(a))
    if len(a) != len(b):
        return a[index:] == b[index+1:]
    return (a[index+1:] == b[index+1:] or
            (index + 1 < len(a) and a[index:index+2] == b[index:index+2][::-1]
             and a[index+2:] == b[index+2:]))


def score(query, value, *, line=False):
    """Both operands are normalized. A single wrong character is too broad for 2-char terms."""
    if not query or not value:
        return 0
    if query == value:
        return 100
    if query in value:
        return 96 if line else 94 - min(5, len(value) - len(query))
    if pinyin(query) == pinyin(value):
        return 88
    if len(query) < 3:
        if len(query) == 2 and len(value) == 3 and _one_edit(query, value):
            return 72
        return 0
    if _one_edit(query, value):
        return 82
    if line:
        # Search bounded windows so an imperfect fragment can match a longer lyric line.
        for length in (len(query), len(query) + 1, len(query) - 1):
            if length < 3:
                continue
            for start in range(len(value) - length + 1):
                if _one_edit(query, value[start:start+length]):
                    return 75
    return 0


def _variants(query):
    n = len(query)
    forms = [pinyin(query)]
    if n == 2:
        forms.extend(query)
    if n >= 3:
        # Prefix, suffix and middle anchors survive one bad character in longer queries.
        size = max(2, n // 2)
        forms.extend([query[:size], query[-size:], query[(n-size)//2:(n+size)//2]])
        if n <= 4:
            forms.extend(query[:i]+query[i+1]+query[i]+query[i+2:] for i in range(n-1))
            forms.extend([query[0], query[-1]])
    return [term for term in dict.fromkeys(forms) if term and term != query]


def _names(artist):
    return [name for name in _SEPARATORS.split(artist.strip()) if name]


def _best_line(raw, query, proxy, period):
    body = next((raw[k] for k in ('lyrics','lrc') if isinstance(raw.get(k), str) and raw[k].strip()), '')
    if not body:
        try:
            data = music._lyrics(str(raw['id']), proxy, period)
            body = data['syncedLyrics'] or data['plainLyrics']
        except (requests.RequestException, ValueError):
            return 0, ''
    best = (0, '')
    title = normalize(raw['title'])
    first_line = True
    for raw_line in body[:200000].splitlines()[:1200]:
        text = _TAG.sub('', raw_line).strip()
        if not text or len(text) > 480 or re.match(r'^(?:词|曲|作词|作曲|词曲|编曲|制作人|演唱|原唱|出品|混音)\s*[:：]', text):
            continue
        if first_line:
            first_line = False
            if normalize(re.split(r'\s+[-—]\s+', text, maxsplit=1)[0]) == title:
                continue
        weight = score(query, normalize(text), line=True)
        if weight > best[0]:
            best = weight, text
            if weight >= 96:
                break
    return best


def search(kind, query, proxy, limit):
    clean = normalize(query)
    limit = max(1, min(limit, 50))
    found = {}
    seen = set()
    period = int(time.monotonic()) // 300
    if kind not in ('song','lyric','artist','artistTracks'):
        raise ValueError('未知搜索分类')
    if not clean:
        return {'query':query, 'results':[]}

    def save(key, weight, row):
        if weight and (key not in found or found[key][0] < weight):
            found[key] = weight, row

    def collect(raw_tracks):
        hits = []
        for raw in raw_tracks:
            if not isinstance(raw, dict) or not isinstance(raw.get('id'), (int,str)):
                continue
            key = str(raw['id'])
            if key in seen:
                continue
            rows = music._track_items([raw], 1)
            if not rows:
                continue
            row = rows[0]
            if kind == 'lyric':
                if len(hits) >= 12:
                    break
                hits.append((key, row, _POOL.submit(_best_line,raw,clean,proxy,period)))
            elif kind == 'artist':
                for name in _names(row['channel']):
                    folded = normalize(name)
                    save(folded, score(clean,folded), {'name':name,'resultType':'artist'})
            elif kind == 'artistTracks':
                if any(clean == normalize(name) for name in _names(row['channel'])):
                    save(key,100,row)
            else:
                weight = score(clean, normalize(row['title']))
                # Also support pasted title + artist without populating song results by artist alone.
                if clean in (normalize(row['title']+row['channel']),normalize(row['channel']+row['title'])):
                    weight = 100
                save(key,weight,row)
            seen.add(key)
        for key,row,future in hits:
            weight, snippet = future.result()
            if weight:
                row['snippet'] = snippet
                save(key,weight,row)

    collect(music._search(query,proxy,period))
    if kind == 'lyric' and len(found) < min(limit,3):
        from lyric_candidates import find_tracks
        try:
            collect(find_tracks(query,proxy,limit))
        except (requests.RequestException, ValueError):
            pass
    strong = sum(weight >= 88 for weight,_ in found.values())
    if kind != 'artistTracks' and strong < min(limit, 1 if kind == 'artist' else 3):
        forms = _variants(clean)
        futures = [_POOL.submit(music._search, term, proxy, period) for term in forms]
        # Interleave candidates across variants so a common prefix cannot swallow the lyric budget.
        groups = []
        for future in futures:
            try:
                groups.append(future.result())
            except (requests.RequestException, ValueError):
                continue
        collect([group[i] for i in range(max(map(len,groups),default=0)) for group in groups if i < len(group)])
    if kind == 'song' and not found and len(clean) >= 2:
        # Common one-character anchors can fall outside Neko's capped result page.
        from lyric_candidates import find_tracks
        collect(find_tracks(query, proxy, max(limit, 12), search_type=1))
    results = [row for _,row in sorted(found.values(), key=lambda hit: -hit[0])[:limit]]
    for idx,row in enumerate(results,1):
        if kind != 'artist':
            row['rank'] = idx
    return {'query': query, 'results':results}
