"""Rank public Qishui playlist titles against the current Douyin song query."""

import re
import unicodedata


_DOUYIN = re.compile(r"抖音|\bdouyin\b")
_POPULAR = re.compile(r"热[歌曲门榜]|熱[歌曲門榜]|爆[火红紅款]|最火|走红|刷屏|排行|榜[单單]|\bhits?\b|viral|trending")
_CHART = re.compile(r"排行榜?|热[歌曲]榜|熱門榜|榜[单單]|\bcharts?\b|\brankings?\b")
_UPDATED = re.compile(r"(持续|持續|每日|每周|每週|实时|即時|本月)更新|(?:daily|regularly) updated")
_REMIX = re.compile(r"车载|車載|蹦迪|(?<![a-z])dj(?![a-z])|\bremix\b")
_YEAR = re.compile(r"(?<!\d)(20\d{2})(?!\d)")
_MONTH = re.compile(r"(?<!\d)(\d{1,2})\s*月")
_NUMERIC_MONTH = re.compile(r"(?<!\d)20\d{2}\s*[./-]\s*(\d{1,2})(?!\d)")
_MONTH_RANGE = re.compile(r"(?<!\d)(\d{1,2})\s*(?:[-~—–至到])\s*\d{1,2}\s*月")
_MONTH_NAMES = {name: index for index, name in enumerate(
    "jan feb mar apr may jun jul aug sep oct nov dec".split(), 1
)}
_ENGLISH_MONTH = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    r"\.?\s+20\d{2}\b"
)


def match_score(title: str, year: int, month: int) -> int | None:
    """Return a higher score for a closer playlist, or None for an ineligible title."""
    if not isinstance(title, str):
        return None
    title = " ".join(unicodedata.normalize("NFKC", title).casefold().split())
    if not (_DOUYIN.search(title) and _POPULAR.search(title)) or _REMIX.search(title):
        return None

    years = {int(value) for value in _YEAR.findall(title)}
    if years - {year}:
        return None
    months = {int(value) for pattern in (_MONTH, _NUMERIC_MONTH, _MONTH_RANGE) for value in pattern.findall(title)}
    months.update(_MONTH_NAMES[name[:3]] for name in _ENGLISH_MONTH.findall(title))
    if months - {month}:
        return None

    # An exact date always outranks a year-only playlist regardless of wording.
    date_score = (40 if years else 0) + (20 if months else 0)
    content_score = (8 if _CHART.search(title) else 0) + (4 if _UPDATED.search(title) else 0)
    return date_score + content_score
