import unittest
import os
import sys

# Add project root and server to path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SERVER_DIR = os.path.join(BASE_DIR, "server")
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from parser import parse_bell_time, BELL_TIMES, ScheduleParser


class TestBellTimeParser(unittest.TestCase):
    def test_shortened_one_hour_formats(self):
        """Проверка распознавания сокращённого расписания (пары по 1 часу)."""
        # 1 пара: 8.00-9.00
        res1 = parse_bell_time("8.00-9.00", pair_num=1)
        assert res1["start"] == "08:00"
        assert res1["end"] == "09:00"
        assert res1["s_min"] == 480
        assert res1["e_min"] == 540
        assert res1["display"] == "08:00 - 09:00"

        # 2 пара: 9.10-10.10 с нулями и без
        res2 = parse_bell_time("09:10-10:10", pair_num=2)
        assert res2["start"] == "09:10"
        assert res2["end"] == "10:10"
        assert res2["s_min"] == 550
        assert res2["e_min"] == 610

        # 3 пара: 10.30-11.30 с разными видами тире
        res3_dash = parse_bell_time("10.30 – 11.30", pair_num=3)
        assert res3_dash["start"] == "10:30"
        assert res3_dash["end"] == "11:30"

        res3_emdash = parse_bell_time("10.30—11.30", pair_num=3)
        assert res3_emdash["start"] == "10:30"
        assert res3_emdash["end"] == "11:30"

    def test_regular_two_halves_formats(self):
        """Проверка обычного расписания со звонком на пятиминутку между половинами."""
        # 8.00-8.45 \n 8.50-9.35 -> берётся 08:00 и 09:35
        text_nl = "8.00-8.45\n8.50-9.35"
        res_nl = parse_bell_time(text_nl, pair_num=1)
        assert res_nl["start"] == "08:00"
        assert res_nl["end"] == "09:35"
        assert res_nl["s_min"] == 480
        assert res_nl["e_min"] == 575
        assert res_nl["display"] == "08:00 - 09:35"

        # С косой чертой: 9.45-10.30 / 10.35-11.20
        text_slash = "9.45-10.30 / 10.35-11.20"
        res_slash = parse_bell_time(text_slash, pair_num=2)
        assert res_slash["start"] == "09:45"
        assert res_slash["end"] == "11:20"

    def test_fallback_on_empty_or_invalid(self):
        """При пустой или нераспознанной ячейке используется стандартная сетка BELL_TIMES."""
        res_empty = parse_bell_time("", pair_num=1)
        assert res_empty == BELL_TIMES[1]

        res_none = parse_bell_time(None, pair_num=3)
        assert res_none == BELL_TIMES[3]

        res_invalid = parse_bell_time("какой-то текст без времени", pair_num=4)
        assert res_invalid == BELL_TIMES[4]


class TestLiveSheetBellParsing(unittest.TestCase):
    def test_live_sheet_friday_vs_regular_day(self):
        """Тест парсинга реального расписания: пятница 02.10 (сокращённая) vs понедельник (обычный)."""
        parser = ScheduleParser()
        data = parser.get_data(force_refresh=True)

        assert "day_bell_times" in data, "day_bell_times должен присутствовать в корне расписания"
        day_bells = data["day_bell_times"]

        # 1. Проверяем пятницу (если расписание заполнено для пятницы)
        if "Пятница" in day_bells:
            fri_p1 = day_bells["Пятница"].get(1) or day_bells["Пятница"].get("1")
            assert fri_p1 is not None, "Пятница: 1 пара должна присутствовать в сетке"
            assert fri_p1["start"] == "08:00"
            assert fri_p1["end"] == "09:00", f"В пятницу 1 пара должна заканчиваться в 09:00, получено: {fri_p1['end']}"
            assert fri_p1["e_min"] - fri_p1["s_min"] == 60, "Длительность пары в пятницу должна быть 60 минут"

            fri_p2 = day_bells["Пятница"].get(2) or day_bells["Пятница"].get("2")
            assert fri_p2["start"] == "09:10"
            assert fri_p2["end"] == "10:10"

            fri_p3 = day_bells["Пятница"].get(3) or day_bells["Пятница"].get("3")
            assert fri_p3["start"] == "10:30"
            assert fri_p3["end"] == "11:30"

        # 2. Проверяем обычный день (Понедельник)
        if "Понедельник" in day_bells:
            mon_p1 = day_bells["Понедельник"].get(1) or day_bells["Понедельник"].get("1")
            assert mon_p1 is not None
            assert mon_p1["start"] == "08:00"
            assert mon_p1["end"] == "09:35", f"В понедельник 1 пара должна заканчиваться в 09:35, получено: {mon_p1['end']}"
            assert mon_p1["e_min"] - mon_p1["s_min"] == 95, "Длительность обычной пары должна быть 95 минут"

        # 3. Проверяем, что в расписании любой группы в пятницу пары имеют правильное время
        schedules = data.get("schedules", {})
        if schedules:
            first_group = next(iter(schedules.values()))
            fri_pairs = first_group.get("days", {}).get("Пятница", [])
            if fri_pairs:
                first_fri_pair = fri_pairs[0]
                assert first_fri_pair["start"] == "08:00"
                assert first_fri_pair["end"] == "09:00"
                assert first_fri_pair["time"] == "08:00 - 09:00"


if __name__ == "__main__":
    unittest.main()

