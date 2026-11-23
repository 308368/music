import base64
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app/src/main/python"))

import douyin_trends as trends


class PlaylistTests(unittest.TestCase):
    def test_search_accepts_only_public_qishui_playlist_links(self):
        target = "https://music.douyin.com/qishui/share/playlist?playlist_id=7200303561195061287"
        token = base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")
        html = f"""
            <a href="/ck/a?u=a1{token}&amp;x=1">Bing result</a>
            <a href="https://m.douyin.com/qishui/playlist/7453605210947242024">Share</a>
            <a href="https://music.douyin.com.fake.invalid/qishui/share/playlist?playlist_id=7200000000000000000">Fake</a>
            <a href="https://music.douyin.com/qishui/share/track?track_id=7220000000000000000">Song</a>
        """
        self.assertEqual(
            set(trends._playlist_ids(html)),
            {"7200303561195061287", "7453605210947242024"},
        )

    def test_fetch_uses_the_single_best_playlist_and_its_order(self):
        first_id, second_id = "7200303561195061287", "7188047799517904953"
        third_id = "7203983736064622592"
        titles = {
            first_id: "2018-2026抖音热歌",
            second_id: "2026抖音爆款热歌丨好听到可以单曲循环",
            third_id: "2026抖音热歌排行榜【持续更新】",
        }

        def fetch(_session, url, params):
            if url != trends.METADATA_URL:
                return f'<a href="https://m.douyin.com/qishui/playlist/{third_id}">热歌榜</a>'
            playlist_id = params["playlist_id"]
            return json.dumps({"success": True, "data": {
                "playlist_id": playlist_id,
                "name": titles[playlist_id],
                "owner": "艾君子",
                "songlist": [
                    {"name": playlist_id, "singer": [{"name": "原唱"}]},
                    {"name": "榜单第二首", "singer": [{"name": "甲"}, {"name": "乙"}]},
                ],
            }})

        with patch.object(trends, "_get", side_effect=fetch):
            title, owner, songs = trends.fetch_playlist(None, 2026, 11)

        self.assertEqual(title, titles[third_id])
        self.assertEqual(owner, "艾君子")
        self.assertEqual(songs, [(third_id, "原唱"), ("榜单第二首", "甲 / 乙")])


if __name__ == "__main__":
    unittest.main()
