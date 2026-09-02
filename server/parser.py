import csv
import io
import json
import logging
import os
import re
import time
import urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DEFAULT_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/1RRrdDgLjqfFRYhjbxTdcJY_iNvP3ZEuu/export?format=csv"
)
CACHE_FILE = os.path.join(os.path.dirname(__file__), "schedule_cache.json")
CACHE_TTL_SECONDS = 30  # Сверхбыстрое обновление для живой синхронизации (30 сек)

BELL_TIMES = {
    1: {"start": "08:00", "end": "09:35", "display": "08:00 - 09:35", "s_min": 8 * 60, "e_min": 9 * 60 + 35},
    2: {"start": "09:45", "end": "11:20", "display": "09:45 - 11:20", "s_min": 9 * 60 + 45, "e_min": 11 * 60 + 20},
    3: {"start": "11:50", "end": "13:25", "display": "11:50 - 13:25", "s_min": 11 * 60 + 50, "e_min": 13 * 60 + 25},
    4: {"start": "13:55", "end": "15:30", "display": "13:55 - 15:30", "s_min": 13 * 60 + 55, "e_min": 15 * 60 + 30},
    5: {"start": "15:40", "end": "17:15", "display": "15:40 - 17:15", "s_min": 15 * 60 + 40, "e_min": 17 * 60 + 15},
    6: {"start": "17:25", "end": "19:00", "display": "17:25 - 19:00", "s_min": 17 * 60 + 25, "e_min": 19 * 60 + 0},
}

BREAK_TIMES = [
    {
        "after_pair": 1,
        "before_pair": 2,
        "start": "09:35",
        "end": "09:45",
        "duration": 10,
        "is_big": False,
        "title": "Перемена 10 мин",
        "icon": "",
        "s_min": 9 * 60 + 35,
        "e_min": 9 * 60 + 45,
    },
    {
        "after_pair": 2,
        "before_pair": 3,
        "start": "11:20",
        "end": "11:50",
        "duration": 30,
        "is_big": True,
        "title": "Большая перемена 30 мин (Обед)",
        "icon": "",
        "s_min": 11 * 60 + 20,
        "e_min": 11 * 60 + 50,
    },
    {
        "after_pair": 3,
        "before_pair": 4,
        "start": "13:25",
        "end": "13:55",
        "duration": 30,
        "is_big": True,
        "title": "Большая перемена 30 мин",
        "icon": "",
        "s_min": 13 * 60 + 25,
        "e_min": 13 * 60 + 55,
    },
    {
        "after_pair": 4,
        "before_pair": 5,
        "start": "15:30",
        "end": "15:40",
        "duration": 10,
        "is_big": False,
        "title": "Перемена 10 мин",
        "icon": "",
        "s_min": 15 * 60 + 30,
        "e_min": 15 * 60 + 40,
    },
    {
        "after_pair": 5,
        "before_pair": 6,
        "start": "17:15",
        "end": "17:25",
        "duration": 10,
        "is_big": False,
        "title": "Перемена 10 мин",
        "icon": "",
        "s_min": 17 * 60 + 15,
        "e_min": 17 * 60 + 25,
    },
]

DAYS_ORDER = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]

def get_academic_week_info(target_date=None) -> Dict[str, Any]:
    """Точный расчет учебной недели: номер, числитель (I) или знаменатель (II).
    Принимает datetime, date или None (текущее время).
    """
    from datetime import date as date_type
    if target_date is None:
        target_date = datetime.now()
    # Нормализуем: если передан date — конвертируем в datetime
    if isinstance(target_date, date_type) and not isinstance(target_date, datetime):
        target_date = datetime(target_date.year, target_date.month, target_date.day)
    year = target_date.year if target_date.month >= 8 else target_date.year - 1
    sept_first = datetime(year, 9, 1)
    sept_first_monday = sept_first - timedelta(days=sept_first.weekday())
    diff_days = (target_date.date() - sept_first_monday.date()).days
    week_num = max(1, (diff_days // 7) + 1)
    is_numerator = (week_num % 2 == 1)
    parity_code = "num" if is_numerator else "den"
    parity_name = "Числитель (I)" if is_numerator else "Знаменатель (II)"
    return {
        "week_number": week_num,
        "is_numerator": is_numerator,
        "parity": parity_code,
        "parity_name": parity_name,
        "date_str": target_date.strftime("%d.%m.%Y"),
    }

TEACHER_REGEX = re.compile(
    r"([А-ЯЁ][а-яё\-]+)\s+([А-ЯЁ])[\.\s]*([А-ЯЁ])?\.?$"
)
SUBJECT_CODE_PREFIX = re.compile(
    r"^(ОУП|ОП|МДК|СГЦ|ДУП|ЕН|ОГСЭ)[0-9\.\-_]*"
)
SUBJECT_CODE_REGEX = re.compile(
    r"^([А-Яа-яA-Za-z0-9_\-\.]{2,12})\s+(.+)$", re.DOTALL
)


def parse_lesson_entry(text: str) -> Tuple[str, str, str]:
    """Разделяет текст записи на код предмета, название предмета и преподавателя."""
    text = text.strip()
    if not text:
        return "", "", ""
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    teacher = ""
    subj_lines = []

    for idx in range(len(lines) - 1, -1, -1):
        line = lines[idx]
        t_match = TEACHER_REGEX.search(line)
        if t_match:
            init2 = f"{t_match.group(3)}." if t_match.group(3) else ""
            teacher = f"{t_match.group(1)} {t_match.group(2)}.{init2}"
            if idx == 0:
                # Преподаватель в той же строке что и предмет — берём текст до него
                before_teacher = line[:t_match.start()].strip()
                subj_lines = [before_teacher] if before_teacher else []
            else:
                subj_lines = lines[:idx]
            break
        elif "Вакансия" in line:
            teacher = "Вакансия"
            subj_lines = lines[:idx]
            break

    if not teacher:
        t_match2 = TEACHER_REGEX.search(text)
        if t_match2:
            init2 = f"{t_match2.group(3)}." if t_match2.group(3) else ""
            teacher = f"{t_match2.group(1)} {t_match2.group(2)}.{init2}"
            subject_raw = text[:t_match2.start()].strip()
        else:
            subject_raw = " ".join(lines).strip()
    else:
        subject_raw = " ".join(subj_lines).strip()

    subject_raw = re.sub(r"\s+", " ", subject_raw)

    code = ""
    c_match = SUBJECT_CODE_REGEX.match(subject_raw)
    if c_match and ("." in c_match.group(1) or SUBJECT_CODE_PREFIX.match(c_match.group(1))):
        code = c_match.group(1)
        subject_name = c_match.group(2).strip()
    else:
        subject_name = subject_raw

    return code, subject_name, teacher


def parse_schedule_cell(raw_text: str, aud: str = "") -> Optional[Dict[str, Any]]:
    """Детальный парсинг ячейки с распознаванием замен (03.09 отмена ... / замена), отмен и дистанта."""
    text = raw_text.strip()
    if not text:
        return None

    aud_clean = aud.strip()
    is_distant = ("дистант" in text.lower()) or ("дистант" in aud_clean.lower())

    if text.lower() == "дистант":
        return {
            "type": "distant",
            "is_replacement": False,
            "is_cancelled": False,
            "is_distant": True,
            "date": "",
            "code": "",
            "subject": "Дистанционное обучение",
            "teacher": "",
            "classroom": "Дистант",
            "cancelled_code": "",
            "cancelled_subject": "",
            "cancelled_teacher": "",
            "raw": text,
        }

    otmena_match = re.search(r"(\d{1,2}\.\d{1,2})?\s*отмена\s*", text, re.IGNORECASE)
    date_direct_match = re.match(r"^(\d{1,2}\.\d{1,2})\s+(.+)$", text, re.DOTALL)

    if otmena_match:
        date_str = otmena_match.group(1) or ""
        after_otmena = text[otmena_match.end():].strip()
        lines = [line.strip() for line in after_otmena.split("\n") if line.strip()]

        # Если после слова «отмена» ничего нет — просто отмена без указания предмета
        if not lines:
            return {
                "type": "cancelled",
                "is_replacement": False,
                "is_cancelled": True,
                "is_distant": is_distant,
                "date": date_str,
                "code": "",
                "subject": "Пара отменена",
                "teacher": "",
                "classroom": "",
                "cancelled_code": "",
                "cancelled_subject": "Пара отменена",
                "cancelled_teacher": "",
                "raw": text,
            }

        split_idx = -1
        for idx in range(len(lines)):
            line = lines[idx]
            if TEACHER_REGEX.search(line) or "Вакансия" in line:
                if idx < len(lines) - 1:
                    split_idx = idx + 1
                    break
            elif idx > 0 and SUBJECT_CODE_PREFIX.match(line):
                split_idx = idx
                break

        if split_idx != -1:
            cancelled_text = "\n".join(lines[:split_idx])
            replacement_text = "\n".join(lines[split_idx:])

            c_code, c_subj, c_teacher = parse_lesson_entry(cancelled_text)
            r_code, r_subj, r_teacher = parse_lesson_entry(replacement_text)

            # Если замена содержит предмет — это замена; иначе — просто отмена
            if r_subj:
                return {
                    "type": "replacement",
                    "is_replacement": True,
                    "is_cancelled": False,
                    "is_distant": is_distant,
                    "date": date_str,
                    "code": r_code,
                    "subject": r_subj,
                    "teacher": r_teacher,
                    "classroom": aud_clean if aud_clean and aud_clean.lower() != "дистант" else ("Дистант" if is_distant else ""),
                    "cancelled_code": c_code,
                    "cancelled_subject": c_subj or "Пара отменена",
                    "cancelled_teacher": c_teacher,
                    "raw": text,
                }
            else:
                return {
                    "type": "cancelled",
                    "is_replacement": False,
                    "is_cancelled": True,
                    "is_distant": is_distant,
                    "date": date_str,
                    "code": c_code,
                    "subject": c_subj or "Пара отменена",
                    "teacher": c_teacher,
                    "classroom": "",
                    "cancelled_code": c_code,
                    "cancelled_subject": c_subj or "Пара отменена",
                    "cancelled_teacher": c_teacher,
                    "raw": text,
                }
        else:
            # После слова "отмена" указан только один предмет — значит, этот предмет и отменен
            c_code, c_subj, c_teacher = parse_lesson_entry(after_otmena)
            return {
                "type": "cancelled",
                "is_replacement": False,
                "is_cancelled": True,
                "is_distant": is_distant,
                "date": date_str,
                "code": c_code,
                "subject": c_subj or "Пара отменена",
                "teacher": c_teacher,
                "classroom": "",
                "cancelled_code": c_code,
                "cancelled_subject": c_subj or "Пара отменена",
                "cancelled_teacher": c_teacher,
                "raw": text,
            }
    elif date_direct_match and not SUBJECT_CODE_PREFIX.match(text):
        # Пары вида: "03.09 ОП.02 Физика Новиков Д.В." (замена / добавление пары)
        date_str = date_direct_match.group(1)
        lesson_text = date_direct_match.group(2).strip()
        code, subj, teacher = parse_lesson_entry(lesson_text)
        return {
            "type": "replacement",
            "is_replacement": True,
            "is_cancelled": False,
            "is_distant": is_distant,
            "date": date_str,
            "code": code,
            "subject": subj,
            "teacher": teacher,
            "classroom": aud_clean if aud_clean and aud_clean.lower() != "дистант" else ("Дистант" if is_distant else ""),
            "cancelled_code": "",
            "cancelled_subject": "",
            "cancelled_teacher": "",
            "raw": text,
        }
    else:
        code, subj, teacher = parse_lesson_entry(text)
        return {
            "type": "regular",
            "is_replacement": False,
            "is_cancelled": False,
            "is_distant": is_distant,
            "date": "",
            "code": code,
            "subject": subj,
            "teacher": teacher,
            "classroom": aud_clean,
            "cancelled_code": "",
            "cancelled_subject": "",
            "cancelled_teacher": "",
            "raw": text,
        }


class ScheduleParser:
    def __init__(self, sheet_url: str = DEFAULT_SHEET_URL, cache_file: str = CACHE_FILE):
        self.sheet_url = sheet_url
        self.cache_file = cache_file
        self.data: Optional[Dict[str, Any]] = None
        self.last_updated: float = 0

    def fetch_csv(self) -> str:
        """Загрузка живой таблицы через Google Sheets export."""
        logger.info(f"Загрузка таблицы: {self.sheet_url}")
        req = urllib.request.Request(
            self.sheet_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
            },
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.read().decode("utf-8")

    def parse(self, raw_csv: Optional[str] = None) -> Dict[str, Any]:
        """Парсинг CSV в структурированный JSON."""
        if raw_csv is None:
            raw_csv = self.fetch_csv()

        reader = list(csv.reader(io.StringIO(raw_csv)))
        if len(reader) < 6:
            raise ValueError("Недостаточно строк в таблице расписания")

        # Поиск строки групп и курсов
        courses_row_idx = 3
        groups_row_idx = 4

        for idx, r in enumerate(reader[:10]):
            if any("9-" in c or "11-" in c for c in r):
                groups_row_idx = idx
                courses_row_idx = max(0, idx - 1)
                break

        courses_row = reader[courses_row_idx]
        groups_row = reader[groups_row_idx]

        # Карта категорий колонок
        col_to_course: Dict[int, str] = {}
        current_course = "Общий"
        for c_idx, cell in enumerate(courses_row):
            c_val = cell.strip().replace("\n", " ")
            if c_val and not c_val.startswith("Дни") and not c_val.startswith("№") and not c_val.startswith("Время"):
                current_course = c_val
            col_to_course[c_idx] = current_course

        # Находим группы
        groups_meta: Dict[str, Dict[str, Any]] = {}
        for c_idx, cell in enumerate(groups_row):
            val = cell.strip()
            if not val or val == "Аудитории" or val.startswith("Дни") or val.startswith("№") or val.startswith("Время"):
                continue

            aud_col = c_idx + 1 if c_idx + 1 < len(groups_row) else None
            course_name = col_to_course.get(c_idx, "Общий")
            
            course_num = "1 курс"
            if "2 курс" in course_name or "-25" in val:
                course_num = "2 курс"
            elif "3 курс" in course_name or "-24" in val:
                course_num = "3 курс"
            elif "4 курс" in course_name or "-23" in val:
                course_num = "4 курс"
            elif "ОЧНО-ЗАОЧНОЕ" in course_name or "оз" in val.lower():
                course_num = "Очно-заочное"

            groups_meta[val] = {
                "name": val,
                "col_idx": c_idx,
                "aud_col": aud_col,
                "section": course_name,
                "course": course_num,
            }

        # Парсинг строк дней
        days_data: Dict[str, List[Dict[str, Any]]] = {}
        current_day = None
        day_dates: Dict[str, str] = {}

        for r_idx in range(groups_row_idx + 1, len(reader)):
            r = reader[r_idx]
            first_col = r[0].strip() if len(r) > 0 else ""

            for d in DAYS_ORDER:
                if d.lower() in first_col.lower():
                    current_day = d
                    date_match = re.search(r"(\d{1,2}\.\d{1,2})", first_col)
                    if date_match:
                        day_dates[current_day] = date_match.group(1)
                    break

            if not current_day:
                continue

            if current_day not in days_data:
                days_data[current_day] = []

            days_data[current_day].append(r)

        # Формирование расписания по группам
        schedules_by_group: Dict[str, Dict[str, Any]] = {}
        all_teachers: Dict[str, List[Dict[str, Any]]] = {}
        all_classrooms: Dict[str, List[Dict[str, Any]]] = {}

        for group_name, g_info in groups_meta.items():
            g_col = g_info["col_idx"]
            a_col = g_info["aud_col"]

            group_schedule: Dict[str, List[Dict[str, Any]]] = {}

            for day_name in DAYS_ORDER:
                sub_rows = days_data.get(day_name, [])
                pairs: List[Dict[str, Any]] = []

                for pair_num in range(1, 7):
                    r_top_idx = (pair_num - 1) * 2
                    r_bot_idx = r_top_idx + 1

                    row_top = sub_rows[r_top_idx] if r_top_idx < len(sub_rows) else []
                    row_bot = sub_rows[r_bot_idx] if r_bot_idx < len(sub_rows) else []

                    top_text = row_top[g_col].strip() if g_col < len(row_top) else ""
                    bot_text = row_bot[g_col].strip() if g_col < len(row_bot) else ""

                    top_aud = (
                        row_top[a_col].strip()
                        if a_col is not None and a_col < len(row_top)
                        else ""
                    )
                    bot_aud = (
                        row_bot[a_col].strip()
                        if a_col is not None and a_col < len(row_bot)
                        else ""
                    )

                    time_info = BELL_TIMES.get(
                        pair_num,
                        {"start": "00:00", "end": "00:00", "display": "Не указано"},
                    )

                    if not top_text and not bot_text:
                        pairs.append({
                            "pair_num": pair_num,
                            "time": time_info["display"],
                            "start": time_info["start"],
                            "end": time_info["end"],
                            "is_empty": True,
                            "both": None,
                            "numerator": None,
                            "denominator": None,
                            "is_split": False,
                        })
                        continue

                    top_obj = parse_schedule_cell(top_text, top_aud)
                    bot_obj = parse_schedule_cell(bot_text, bot_aud)

                    is_both = False
                    is_split = False

                    if top_text and not bot_text:
                        is_both = True
                    elif top_text == bot_text and top_aud == bot_aud:
                        is_both = True
                    else:
                        is_split = True

                    pair_data: Dict[str, Any] = {
                        "pair_num": pair_num,
                        "time": time_info["display"],
                        "start": time_info["start"],
                        "end": time_info["end"],
                        "is_empty": False,
                        "is_split": is_split,
                        "has_replacement": bool((top_obj and top_obj.get("is_replacement")) or (bot_obj and bot_obj.get("is_replacement"))),
                        "has_cancellation": bool((top_obj and top_obj.get("is_cancelled")) or (bot_obj and bot_obj.get("is_cancelled"))),
                        "has_distant": bool((top_obj and top_obj.get("is_distant")) or (bot_obj and bot_obj.get("is_distant"))),
                    }

                    if is_both:
                        pair_data["both"] = top_obj
                        pair_data["numerator"] = dict(top_obj) if top_obj else None
                        pair_data["denominator"] = dict(top_obj) if top_obj else None

                        if top_obj:
                            t_teacher = top_obj.get("teacher")
                            t_aud = top_obj.get("classroom")
                            t_subj = top_obj.get("subject")
                            if t_teacher and t_teacher != "Вакансия" and not top_obj.get("is_cancelled"):
                                all_teachers.setdefault(t_teacher, []).append({
                                    "group": group_name,
                                    "day": day_name,
                                    "pair_num": pair_num,
                                    "time": time_info["display"],
                                    "subject": t_subj,
                                    "classroom": t_aud,
                                    "week": "Каждую неделю",
                                    "is_replacement": top_obj.get("is_replacement", False),
                                })
                            if t_aud and t_aud.lower() != "дистант" and not top_obj.get("is_cancelled"):
                                all_classrooms.setdefault(t_aud, []).append({
                                    "group": group_name,
                                    "day": day_name,
                                    "pair_num": pair_num,
                                    "time": time_info["display"],
                                    "teacher": t_teacher,
                                    "subject": t_subj,
                                    "week": "Каждую неделю",
                                    "is_replacement": top_obj.get("is_replacement", False),
                                })
                    else:
                        pair_data["both"] = None
                        pair_data["numerator"] = top_obj
                        pair_data["denominator"] = bot_obj

                        if top_obj:
                            t_teacher = top_obj.get("teacher")
                            t_aud = top_obj.get("classroom")
                            t_subj = top_obj.get("subject")
                            if t_teacher and t_teacher != "Вакансия" and not top_obj.get("is_cancelled"):
                                all_teachers.setdefault(t_teacher, []).append({
                                    "group": group_name,
                                    "day": day_name,
                                    "pair_num": pair_num,
                                    "time": time_info["display"],
                                    "subject": t_subj,
                                    "classroom": t_aud,
                                    "week": "Числитель (I)",
                                    "is_replacement": top_obj.get("is_replacement", False),
                                })
                            if t_aud and t_aud.lower() != "дистант" and not top_obj.get("is_cancelled"):
                                all_classrooms.setdefault(t_aud, []).append({
                                    "group": group_name,
                                    "day": day_name,
                                    "pair_num": pair_num,
                                    "time": time_info["display"],
                                    "teacher": t_teacher,
                                    "subject": t_subj,
                                    "week": "Числитель (I)",
                                    "is_replacement": top_obj.get("is_replacement", False),
                                })

                        if bot_obj:
                            b_teacher = bot_obj.get("teacher")
                            b_aud = bot_obj.get("classroom")
                            b_subj = bot_obj.get("subject")
                            if b_teacher and b_teacher != "Вакансия" and not bot_obj.get("is_cancelled"):
                                all_teachers.setdefault(b_teacher, []).append({
                                    "group": group_name,
                                    "day": day_name,
                                    "pair_num": pair_num,
                                    "time": time_info["display"],
                                    "subject": b_subj,
                                    "classroom": b_aud,
                                    "week": "Знаменатель (II)",
                                    "is_replacement": bot_obj.get("is_replacement", False),
                                })
                            if b_aud and b_aud.lower() != "дистант" and not bot_obj.get("is_cancelled"):
                                all_classrooms.setdefault(b_aud, []).append({
                                    "group": group_name,
                                    "day": day_name,
                                    "pair_num": pair_num,
                                    "time": time_info["display"],
                                    "teacher": b_teacher,
                                    "subject": b_subj,
                                    "week": "Знаменатель (II)",
                                    "is_replacement": bot_obj.get("is_replacement", False),
                                })

                    pairs.append(pair_data)

                group_schedule[day_name] = pairs

            schedules_by_group[group_name] = {
                "group": group_name,
                "course": g_info["course"],
                "section": g_info["section"],
                "days": group_schedule,
            }

        groups_list = []
        for g_name, g_info in groups_meta.items():
            groups_list.append({
                "name": g_name,
                "course": g_info["course"],
                "section": g_info["section"],
            })

        groups_list.sort(key=lambda x: (x["course"], x["name"]))
        teachers_sorted = sorted(all_teachers.keys())
        classrooms_sorted = sorted(all_classrooms.keys())

        current_week = get_academic_week_info()

        result = {
            "title": "Колледж телекоммуникаций",
            "subtitle": "Расписание учебных занятий на 2026-2027 учебный год 1 семестр",
            "last_updated": datetime.now().strftime("%d.%m.%Y %H:%M:%S"),
            "timestamp": time.time(),
            "groups_count": len(groups_list),
            "groups": groups_list,
            "day_dates": day_dates,
            "schedules": schedules_by_group,
            "teachers": teachers_sorted,
            "teacher_schedules": all_teachers,
            "classrooms": classrooms_sorted,
            "classroom_schedules": all_classrooms,
            "bell_times": BELL_TIMES,
            "break_times": BREAK_TIMES,
            "week_info": current_week,
        }

        self.data = result
        self.last_updated = time.time()
        self.save_cache()
        return result

    def save_cache(self) -> None:
        """Сохранение кэша в файл."""
        try:
            if self.data:
                with open(self.cache_file, "w", encoding="utf-8") as f:
                    json.dump(self.data, f, ensure_ascii=False, indent=2)
                logger.info(f"Кэш сохранён в {self.cache_file}")
        except Exception as e:
            logger.error(f"Ошибка сохранения кэша: {e}")

    def load_cache(self) -> Optional[Dict[str, Any]]:
        """Загрузка кэша из файла."""
        if not os.path.exists(self.cache_file):
            return None
        try:
            mtime = os.path.getmtime(self.cache_file)
            with open(self.cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.data = data
            self.last_updated = mtime
            return data
        except Exception as e:
            logger.error(f"Ошибка чтения кэша: {e}")
            return None

    def get_data(self, force_refresh: bool = False) -> Dict[str, Any]:
        """Получение данных (из памяти, кэша или живой загрузки)."""
        if not force_refresh and self.data and (time.time() - self.last_updated < CACHE_TTL_SECONDS):
            return self.data

        if not force_refresh:
            cached = self.load_cache()
            if cached and (time.time() - self.last_updated < CACHE_TTL_SECONDS):
                return cached

        try:
            return self.parse()
        except Exception as e:
            logger.error(f"Ошибка парсинга живой таблицы: {e}")
            cached = self.load_cache()
            if cached:
                logger.warning("Используем устаревший кэш из-за ошибки сети")
                return cached
            raise


# Синглтон парсера
parser = ScheduleParser()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Тестирование парсера...")
    res = parser.get_data(force_refresh=True)
    print(f"Успешно спарсено: {res['groups_count']} групп")
    print(f"Преподавателей: {len(res['teachers'])}")
    print(f"Аудиторий: {len(res['classrooms'])}")
