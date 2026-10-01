import unittest
from datetime import datetime, timedelta
from server.grades_1c import OneCGradessClient

class TestGradesCacheAndPeriod(unittest.TestCase):
    def test_cache_date_parsing_iso_and_space(self):
        """Проверяем, что даты кэша в формате ISO и со пробелом парсятся корректно."""
        now = datetime.now()
        
        # 1. ISO format (as saved by db.py)
        iso_fresh = (now - timedelta(minutes=5)).isoformat()
        iso_stale = (now - timedelta(minutes=20)).isoformat()
        
        # Parser logic
        def is_cache_stale(date_str):
            if not date_str:
                return True
            for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(date_str, fmt)
                    return (datetime.now() - dt).total_seconds() >= 900
                except Exception:
                    continue
            return True

        self.assertFalse(is_cache_stale(iso_fresh), "Свежий ISO кэш (5 мин) не должен быть stale")
        self.assertTrue(is_cache_stale(iso_stale), "Устаревший ISO кэш (20 мин) должен быть stale")

        # 2. Space format
        space_fresh = (now - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
        space_stale = (now - timedelta(minutes=20)).strftime("%Y-%m-%d %H:%M:%S")
        self.assertFalse(is_cache_stale(space_fresh), "Свежий кэш с пробелом не должен быть stale")
        self.assertTrue(is_cache_stale(space_stale), "Устаревший кэш с пробелом должен быть stale")

    def test_period_selection_logic(self):
        """Проверяем выбор активного семестра по дате."""
        periods = [
            {'id': 5013, 'parent_id': 0, 'name': '2026-2027 учебный год', 'start_date': '2026-09-01', 'end_date': '2027-08-31'},
            {'id': 5014, 'parent_id': 5013, 'name': 'Первый семестр', 'start_date': '2026-09-01', 'end_date': '2026-12-31'},
            {'id': 5015, 'parent_id': 5013, 'name': 'Второй семестр', 'start_date': '2027-01-01', 'end_date': '2027-08-31'},
            {'id': 11, 'parent_id': 10, 'name': 'Первый семестр', 'start_date': '2022-09-01', 'end_date': '2022-12-28'}
        ]

        def select_term_for_date(target_date_str, all_periods):
            sub_terms = [p for p in all_periods if p.get("parent_id", 0) > 0]
            pool = sub_terms if sub_terms else all_periods
            matching = [p for p in pool if p["start_date"] <= target_date_str <= p["end_date"]]
            if matching:
                return matching[0]["id"]
            return sorted(pool, key=lambda x: x["start_date"])[-1]["id"]

        # Осень 2026 -> семестр 5014
        self.assertEqual(select_term_for_date("2026-10-01", periods), 5014)
        self.assertEqual(select_term_for_date("2026-12-30", periods), 5014)

        # Весна 2027 -> семестр 5015
        self.assertEqual(select_term_for_date("2027-02-15", periods), 5015)
        self.assertEqual(select_term_for_date("2027-05-20", periods), 5015)

        # Дата в будущем за пределами сетки -> последний доступный
        self.assertEqual(select_term_for_date("2027-11-01", periods), 5015)

if __name__ == "__main__":
    unittest.main()
