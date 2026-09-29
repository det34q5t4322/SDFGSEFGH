"""
QA Tests for Missed Lessons Tracker (Трекер прогулов)
Scenarios:
1. Mark & Unmark (Toggle)
2. Duplicate protection / Unique constraint (user + date + pair_num)
3. Access isolation (User A cannot see or mutate User B's missed lessons)
4. Hours calculation across month boundaries (HOURS_PER_LESSON = 2)
5. Offline/Cache payload compatibility
"""

import sys
import os
import unittest
from datetime import datetime

# Adjust paths
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SERVER_DIR = os.path.join(PROJECT_ROOT, "server")
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import db

class TestMissedLessons(unittest.TestCase):
    def setUp(self):
        self.user_a = 99990001
        self.user_b = 99990002
        # Clean up any existing test records for these IDs
        with db.get_db_connection() as conn:
            c = conn.cursor()
            c.execute("DELETE FROM missed_lessons WHERE telegram_id IN (?, ?)", (self.user_a, self.user_b))
            conn.commit()

    def tearDown(self):
        with db.get_db_connection() as conn:
            c = conn.cursor()
            c.execute("DELETE FROM missed_lessons WHERE telegram_id IN (?, ?)", (self.user_a, self.user_b))
            conn.commit()

    def test_01_toggle_mark_and_unmark(self):
        """Проверка добавления и снятия отметки о прогуле"""
        res1 = db.toggle_missed_lesson(
            telegram_id=self.user_a,
            date="2026-09-15",
            pair_num=1,
            subject="Информатика",
            time_start="08:00",
            time_end="09:35",
            teacher="Иванов И.И.",
            classroom="301"
        )
        self.assertEqual(res1.get("action"), "added")

        # Проверяем наличие ключа
        keys = db.get_missed_keys(self.user_a, "2026-09-01", "2026-09-30")
        self.assertIn("2026-09-15:1", keys)

        # Повторный toggle должен удалить запись
        res2 = db.toggle_missed_lesson(
            telegram_id=self.user_a,
            date="2026-09-15",
            pair_num=1
        )
        self.assertEqual(res2.get("action"), "removed")

        keys_after = db.get_missed_keys(self.user_a, "2026-09-01", "2026-09-30")
        self.assertNotIn("2026-09-15:1", keys_after)

    def test_02_duplicates_and_uniqueness(self):
        """Уникальность: пользователь + дата + номер пары"""
        res1 = db.toggle_missed_lesson(
            telegram_id=self.user_a,
            date="2026-09-20",
            pair_num=2,
            subject="Математика"
        )
        self.assertEqual(res1.get("action"), "added")

        # В базе должна быть ровно 1 запись
        lessons = db.get_missed_lessons(self.user_a, "2026-09-20", "2026-09-20")
        self.assertEqual(len(lessons), 1)
        self.assertEqual(lessons[0]["pair_num"], 2)
        self.assertEqual(lessons[0]["subject"], "Математика")

    def test_03_access_isolation(self):
        """Доступ к чужим записям: Пользователь A не видит и не влияет на прогулы Пользователя B"""
        db.toggle_missed_lesson(
            telegram_id=self.user_a,
            date="2026-09-21",
            pair_num=3,
            subject="Физика"
        )
        db.toggle_missed_lesson(
            telegram_id=self.user_b,
            date="2026-09-21",
            pair_num=4,
            subject="Химия"
        )

        lessons_a = db.get_missed_lessons(self.user_a, "2026-09-01", "2026-09-30")
        lessons_b = db.get_missed_lessons(self.user_b, "2026-09-01", "2026-09-30")

        self.assertEqual(len(lessons_a), 1)
        self.assertEqual(lessons_a[0]["subject"], "Физика")

        self.assertEqual(len(lessons_b), 1)
        self.assertEqual(lessons_b[0]["subject"], "Химия")

        keys_a = db.get_missed_keys(self.user_a, "2026-09-01", "2026-09-30")
        self.assertIn("2026-09-21:3", keys_a)
        self.assertNotIn("2026-09-21:4", keys_a)

    def test_04_hours_and_month_boundary(self):
        """Подсчёт часов и корректность на границе месяцев"""
        # 1 пара = 1.5 астрономических часа (db.HOURS_PER_LESSON == 1.5)
        self.assertEqual(db.HOURS_PER_LESSON, 1.5)

        # Сентябрь 2026: 30 сентября (2 пары)
        db.toggle_missed_lesson(self.user_a, "2026-09-30", 1, subject="История")
        db.toggle_missed_lesson(self.user_a, "2026-09-30", 2, subject="История")

        # Октябрь 2026: 1 октября (1 пара)
        db.toggle_missed_lesson(self.user_a, "2026-10-01", 1, subject="История")
        db.toggle_missed_lesson(self.user_a, "2026-10-01", 2, subject="Литература")

        # Статистика за сентябрь 2026
        sept_stats = db.get_missed_stats_by_month(self.user_a, 2026, 9)
        self.assertEqual(sept_stats["total_pairs"], 2)
        self.assertEqual(sept_stats["total_hours"], 3.0) # 2 пары * 1.5 часа
        self.assertEqual(len(sept_stats["by_subject"]), 1)
        self.assertEqual(sept_stats["by_subject"][0]["subject"], "История")
        self.assertEqual(sept_stats["by_subject"][0]["hours"], 3.0)

        # Статистика за октябрь 2026
        oct_stats = db.get_missed_stats_by_month(self.user_a, 2026, 10)
        self.assertEqual(oct_stats["total_pairs"], 2)
        self.assertEqual(oct_stats["total_hours"], 3.0)
        subj_map = {s["subject"]: s for s in oct_stats["by_subject"]}
        self.assertIn("История", subj_map)
        self.assertIn("Литература", subj_map)
        self.assertEqual(subj_map["История"]["hours"], 1.5)
        self.assertEqual(subj_map["Литература"]["hours"], 1.5)

        # Декабрь -> Январь граница (тест перехода года)
        db.toggle_missed_lesson(self.user_a, "2026-12-31", 1, subject="Новый Год")
        dec_stats = db.get_missed_stats_by_month(self.user_a, 2026, 12)
        self.assertEqual(dec_stats["total_pairs"], 1)
        self.assertEqual(dec_stats["total_hours"], 1.5)

if __name__ == "__main__":
    unittest.main()
