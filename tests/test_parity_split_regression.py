# -*- coding: utf-8 -*-
import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from parser import ScheduleParser

class TestParitySplitRegression(unittest.TestCase):
    def test_bottom_only_cell_is_not_both(self):
        parser = ScheduleParser()
        sched = parser.get_data('161540657')
        group_key = 'ИСС9-25'
        day_key = 'Четверг'
        self.assertIn('schedules', sched)
        self.assertIn(group_key, sched['schedules'])

        thu_pairs = sched['schedules'][group_key]['days'][day_key]
        p3 = thu_pairs[2]
        self.assertEqual(p3['pair_num'], 3)
        self.assertTrue(p3['is_split'], 'Пара с заполненным только знаменателем должна иметь is_split=True')
        self.assertIsNone(p3['both'], 'Пара только для знаменателя не должна иметь both')
        self.assertIsNone(p3['numerator'], 'В числителе (верхней строке) пары быть не должно')
        self.assertIsNotNone(p3['denominator'], 'В знаменателе должна быть пара')
        self.assertIn('телекоммуникаций', p3['denominator']['subject'].lower())

    def test_top_and_both_cells(self):
        parser = ScheduleParser()
        sched = parser.get_data('161540657')
        group_key = 'ИСС9-25'
        day_key = 'Четверг'
        thu_pairs = sched['schedules'][group_key]['days'][day_key]
        p4 = thu_pairs[3]
        self.assertEqual(p4['pair_num'], 4)
        self.assertFalse(p4['is_empty'])
        self.assertIn('экологические', (p4['numerator'] or {}).get('subject', '').lower())

if __name__ == '__main__':
    unittest.main()
