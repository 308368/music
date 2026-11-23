import json
import sys
import unittest
from pathlib import Path
from urllib.parse import urlencode
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app/src/main/python"))
import phone_music
import playlist_search as playlists


class PlaylistSearchTests(unittest.TestCase):
    def test_same_name_on_each_source_survives_one_source_failure(self):
        title = "华语经典老歌"
        def fetch(source):
            params = urlencode({"type": "playlist", "source": source, "q": title})
            return json.loads(phone_music.api("/api/search", params))["results"][0]
        neko = {"success": True, "results": [{"id": 42, "name": title}]}
        netease = {"result": {"playlists": [{"id": 42, "name": title}]}}
        with patch.object(phone_music, "_request", return_value=neko), patch.object(playlists, "_json", return_value=netease):
            with patch.object(playlists, "_discover", side_effect=ValueError("超时")):
                with self.assertRaises(ValueError):
                    fetch("qishui")
            self.assertEqual([(fetch(s)["source"], fetch(s)["name"]) for s in ("neko", "netease")],
                             [("neko", title), ("netease", title)])

    def test_detail_preserves_unmatched_positions_and_recording_versions(self):
        rows = [playlists._row("同名", [{"name": "甲"}]), playlists._row("同名", [{"name": "乙"}]),
                playlists._row("同名", [{"name": "甲"}], "现场专辑"), playlists._row("佚名", [])]
        song = {"id": 10, "title": "同名", "artist": "甲", "album": "首张专辑"}
        with patch.object(playlists, "_external", return_value=({"name": "测试"}, rows)), \
                patch.object(phone_music, "_request", return_value={"results": [song, song, song]}):
            result = playlists.detail("netease", "42")["results"]
        self.assertEqual([r["channel"] for r in result], ["甲", "乙", "甲", ""])
        self.assertEqual([r["track"] and r["track"]["id"] for r in result], ["neko-10", None, None, None])

    def test_qq_uses_ordered_pages(self):
        song = lambda n: {"id": n, "title": str(n), "singer": [{"name": "甲"}]}
        pages = [{"req_0": {"code": 0, "data": {"dirinfo": {"id": 42, "title": "歌单"},
                  "songlist": [song(9)], "total_song_num": 3}}},
                 {"req_0": {"code": 0, "data": {"songlist": [song(8), song(7)]}}}]
        with patch.object(playlists, "_json", side_effect=pages) as request:
            _, rows = playlists._external(None, "qq", "42", True)
        self.assertEqual([r["title"] for r in rows], ["9", "8", "7"])
        self.assertEqual(json.loads(request.call_args.args[2]["data"])["req_0"]["param"]["song_begin"], 1)

    def test_public_link_requires_correct_domain_and_playlist_path(self):
        urls = " ".join(["https://www.qishui.com/playlist/1234567890123",
                         "https://www.qishui.com.invalid/playlist/2345678901234",
                         "https://www.qishui.com/track/3456789012345"])
        self.assertEqual(list(playlists._link_ids(urls, "qishui")), ["1234567890123"])
