import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app/src/main/python"))

from qishui_ranking import match_score


class QishuiRankingTests(unittest.TestCase):
    def test_screenshot_prefers_the_third_playlist(self):
        titles = [
            "2018-2026抖音热歌",
            "精选2018到2025抖音热歌",
            "2026抖音热歌排行榜【持续更新】",
            "2026抖音爆款热歌丨好听到可以单曲循环",
            "2026抖音热歌车载DJ丨开车劲爆重低音舞曲",
            "抖音流行热歌丨2026爆火热搜网红音乐",
        ]
        order = [match_score(title, 2026, 11) for title in titles]
        best = max((score, index) for index, score in enumerate(order) if score is not None)
        self.assertEqual(best[1], 2)

    def test_current_month_outranks_a_yearly_chart(self):
        yearly = match_score("2026抖音热歌排行榜【持续更新】", 2026, 11)
        for title in (
            "２０２６ 年 １１ 月 抖音爆火热歌",
            "2026-11 抖音最火热歌",
            "November 2026 Douyin’s Hit Songs Chart",
            "Nov. 2026 Douyin Trending Songs",
        ):
            with self.subTest(title=title):
                self.assertGreater(match_score(title, 2026, 11), yearly)

    def test_rejects_stale_and_off_topic_playlists(self):
        for title in (
            "2026年10月抖音热歌榜",
            "2026年10-11月抖音热歌合集",
            "2025年11月抖音热歌榜",
            "2026年12月抖音热歌榜",
            "2026年11月影视配乐",
            "2026抖音热歌DJ车载版",
        ):
            with self.subTest(title=title):
                self.assertIsNone(match_score(title, 2026, 11))

    def test_a_year_only_list_does_not_claim_month_specificity(self):
        self.assertEqual(
            match_score("2026抖音热歌排行榜【持续更新】", 2026, 11),
            match_score("2026抖音热歌排行榜【持续更新】", 2026, 12),
        )


if __name__ == "__main__":
    unittest.main()
