import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app/src/main/python'))
import track_search as engine


class TrackSearchTests(unittest.TestCase):
    songs = [
        {'id': 1, 'title': '七里香', 'artist': '周杰伦'},
        {'id': 2, 'title': '七里乡', 'artist': '甲'},
        {'id': 3, 'title': '合作曲', 'artist': '乙 / 周杰伦'},
        {'id': 4, 'title': '周杰伦', 'artist': '丙'},
    ]

    def lookup(self, query, proxy, period):
        return [row for row in self.songs if query in row['title'] or query in row['artist']
                or query in engine.pinyin(row['title']) or query in engine.pinyin(row['artist'])]

    def test_candidates_retrieved_when_original_search_was_empty(self):
        with patch.object(engine.music, '_search', side_effect=self.lookup), patch('lyric_candidates.find_tracks', return_value=[]):
            for query in ('七里香', '七里乡', '七里猫', '七香里', '七里', '七香', '七大里香'):
                with self.subTest(query=query):
                    titles = [row['title'] for row in engine.search('song',query,'',20)['results']]
                    self.assertIn('七里香', titles)
                    if query in ('七里香', '七里乡'):
                        self.assertEqual(titles[0],query)
            self.assertEqual(engine.search('song','七草','',20)['results'],[])

    def test_artist_results_and_details_separate_artist_and_title_matches(self):
        with patch.object(engine.music, '_search', side_effect=self.lookup):
            result = engine.search('artist','周杰轮','',20)['results']
            self.assertEqual([r['name'] for r in result],['周杰伦'])
            works = engine.search('artistTracks','周杰伦','',20)['results']
            self.assertEqual([r['id'] for r in works],['neko-1','neko-3'])

    def test_lyrics_match_actual_line_even_with_typo(self):
        rows = [dict(id=1,title='故事的小黄花',artist='甲',lrc=False),
                dict(id=2,title='晴天',artist='乙',lrc=True)]
        lyrics = {'syncedLyrics':'[ar:故事的小黄花]\n[00:10.10]故事的小黄花 从出生那年就飘着','plainLyrics':''}
        discovery = types.SimpleNamespace(find_tracks=lambda *args: rows)
        def details(track_id, proxy, period):
            if track_id == '1':
                return {'syncedLyrics':'[00:00]故事的小黄花 - 甲\n[00:10]无关正文','plainLyrics':''}
            return lyrics
        with patch.dict(sys.modules, {'lyric_candidates':discovery}), patch.object(engine.music,'_search',return_value=rows), patch.object(engine.music,'_lyrics',side_effect=details):
            for q in ('故事的小黄花', '故事的小黄瓜'):
                hits = engine.search('lyric',q,'',20)['results']
                self.assertEqual([h['id'] for h in hits], ['neko-2'])
                self.assertEqual(hits[0]['snippet'],'故事的小黄花 从出生那年就飘着')


if __name__ == '__main__':
    unittest.main()
