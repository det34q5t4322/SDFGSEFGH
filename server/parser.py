import collections
import csv
import io
import json
import logging
import os
import re
import socket
import time
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    import zoneinfo
    MOSCOW_TZ = zoneinfo.ZoneInfo("Europe/Moscow")
except Exception:
    from datetime import timezone
    MOSCOW_TZ = timezone(timedelta(hours=3))

def get_moscow_now() -> datetime:
    """Возвращает текущую дату и время строго в московском часовом поясе (UTC+3)."""
    return datetime.now(MOSCOW_TZ).replace(tzinfo=None)

logger = logging.getLogger(__name__)

DEFAULT_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/1RRrdDgLjqfFRYhjbxTdcJY_iNvP3ZEuu/export?format=csv"
)
CACHE_FILE = os.path.join(os.path.dirname(__file__), "schedule_cache.json")
KNOWN_TABS_FILE = os.path.join(os.path.dirname(__file__), "known_tabs.json")
TEACHERS_FIO_FILE = os.path.join(os.path.dirname(__file__), "teachers_fio.json")
CACHE_TTL_SECONDS = 30  # Сверхбыстрое обновление для живой синхронизации (30 сек)


_TEACHERS_FIO_CACHE: Optional[Dict[str, str]] = None
_TEACHERS_FIO_MTIME: float = 0.0


def load_teachers_fio() -> Dict[str, str]:
    """Загрузка словаря сопоставления инициалов преподавателей в полные ФИО."""
    global _TEACHERS_FIO_CACHE, _TEACHERS_FIO_MTIME
    if not os.path.exists(TEACHERS_FIO_FILE):
        return {}
    try:
        mtime = os.path.getmtime(TEACHERS_FIO_FILE)
        if _TEACHERS_FIO_CACHE is not None and mtime == _TEACHERS_FIO_MTIME:
            return _TEACHERS_FIO_CACHE
        with open(TEACHERS_FIO_FILE, "r", encoding="utf-8") as f:
            _TEACHERS_FIO_CACHE = json.load(f)
            _TEACHERS_FIO_MTIME = mtime
            return _TEACHERS_FIO_CACHE
    except Exception as e:
        logger.warning(f"Не удалось прочитать teachers_fio.json: {e}")
        return _TEACHERS_FIO_CACHE or {}


def get_full_teacher_name(short_name: str) -> str:
    """Возвращает полное ФИО преподавателя из справочника, если есть, иначе исходное имя."""
    if not short_name:
        return ""
    clean = short_name.strip()
    mapping = load_teachers_fio()
    return mapping.get(clean, clean)


def enrich_schedule_teachers(sheet_data: Dict[str, Any]) -> Dict[str, Any]:
    """Заменяет инициалы преподавателей на полные ФИО во всех парах и списках."""
    mapping = load_teachers_fio()
    if not mapping:
        return sheet_data

    # 1. Список преподавателей
    teachers = sheet_data.get("teachers", [])
    if teachers:
        sheet_data["teachers"] = sorted(list({mapping.get(t, t) for t in teachers}))

    # 2. Расписания преподавателей
    if "teacher_schedules" in sheet_data:
        new_ts = {}
        for t, lessons in sheet_data["teacher_schedules"].items():
            full = mapping.get(t, t)
            for item in lessons:
                if item.get("teacher") and item["teacher"] in mapping:
                    item["teacher"] = mapping[item["teacher"]]
            new_ts.setdefault(full, []).extend(lessons)
        sheet_data["teacher_schedules"] = new_ts

    # 3. Расписание по группам
    for g_data in sheet_data.get("schedules", {}).values():
        for pairs in g_data.get("days", {}).values():
            for pair in pairs:
                for side in ["both", "numerator", "denominator"]:
                    item = pair.get(side)
                    if item and item.get("teacher") and item["teacher"] in mapping:
                        item["teacher"] = mapping[item["teacher"]]
                    if item and item.get("cancelled_teacher") and item["cancelled_teacher"] in mapping:
                        item["cancelled_teacher"] = mapping[item["cancelled_teacher"]]

    return sheet_data


# ─────────────────────────────────────────────
#  Circuit Breaker — защита от шторма запросов
# ─────────────────────────────────────────────
class CircuitBreaker:
    """Защищает от шторма запросов к Google когда он лежит.

    Состояния:
      CLOSED     — всё норм, запросы проходят.
      OPEN       — слишком много ошибок, запросы блокируются на OPEN_TIMEOUT сек.
      HALF_OPEN  — пауза прошла, пробуем один запрос.
    """
    FAILURE_THRESHOLD = 5       # ошибок подряд → OPEN
    OPEN_TIMEOUT = 300          # сек в OPEN (5 минут)
    SUCCESS_THRESHOLD = 2       # успехов в HALF_OPEN → CLOSED

    def __init__(self):
        self._failures = 0
        self._successes = 0
        self._state = "CLOSED"
        self._opened_at: float = 0

    @property
    def state(self) -> str:
        if self._state == "OPEN":
            if time.time() - self._opened_at >= self.OPEN_TIMEOUT:
                self._state = "HALF_OPEN"
                self._successes = 0
                logger.info("CircuitBreaker → HALF_OPEN: пробуем один запрос")
        return self._state

    def allow_request(self) -> bool:
        return self.state in ("CLOSED", "HALF_OPEN")

    def record_success(self):
        self._failures = 0
        if self._state == "HALF_OPEN":
            self._successes += 1
            if self._successes >= self.SUCCESS_THRESHOLD:
                self._state = "CLOSED"
                logger.info("CircuitBreaker → CLOSED: сервис восстановлен")
        elif self._state == "OPEN":
            self._state = "CLOSED"

    def record_failure(self):
        self._failures += 1
        if self._state == "HALF_OPEN":
            self._state = "OPEN"
            self._opened_at = time.time()
            logger.warning("CircuitBreaker → OPEN (повтор): сервис нестабилен, пауза 5 мин")
        elif self._state == "CLOSED" and self._failures >= self.FAILURE_THRESHOLD:
            self._state = "OPEN"
            self._opened_at = time.time()
            logger.warning(
                f"CircuitBreaker → OPEN: {self._failures} ошибок подряд, "
                f"запросы блокированы на {self.OPEN_TIMEOUT} сек"
            )

    def status_dict(self) -> dict:
        return {
            "state": self.state,
            "failures": self._failures,
            "open_since": datetime.fromtimestamp(self._opened_at).strftime("%H:%M:%S") if self._opened_at else None,
        }


# Глобальный circuit breaker (один на весь процесс)
_circuit_breaker = CircuitBreaker()


# Circular buffer для последних 50 ошибок синхронизации Google Sheets
_sync_error_log = collections.deque(maxlen=50)

def record_sync_error(category: str, message: str, url: str = "", http_status: Optional[int] = None, attempt: int = 1) -> None:
    """Записывает детализированную ошибку синхронизации в кольцевой буфер и системный лог."""
    entry = {
        "timestamp": time.time(),
        "iso_time": datetime.now().isoformat(),
        "category": category,
        "message": message,
        "http_status": http_status,
        "url_sample": (url[:80] + "...") if len(url) > 80 else url,
        "attempt": attempt,
    }
    _sync_error_log.append(entry)
    logger.error(f"[GoogleSheets Sync Failure] [{category}] (попытка {attempt}, code={http_status}): {message} | {entry['url_sample']}")

def get_sync_errors() -> List[dict]:
    """Возвращает историю последних ошибок синхронизации Google Sheets."""
    return list(_sync_error_log)


# ─────────────────────────────────────────────
#  Retry с экспоненциальным backoff и логированием причин сбоев
# ─────────────────────────────────────────────
def fetch_with_retry(url: str, retries: int = 3, timeout: int = 20) -> bytes:
    """Загружает URL с повторными попытками при сбое (backoff: 2с → 4с → 8с).
    Уважает CircuitBreaker: если OPEN — сразу бросает исключение.
    Логирует точные причины отвала (таймаут, 403, 429, пустой ответ, сброс сети).
    """
    if not _circuit_breaker.allow_request():
        wait_left = max(0, int(_circuit_breaker.OPEN_TIMEOUT - (time.time() - _circuit_breaker._opened_at)))
        err_msg = f"CircuitBreaker OPEN — запросы к Google временно заблокированы (пауза {wait_left} сек)"
        record_sync_error("CIRCUIT_BREAKER_OPEN", err_msg, url=url)
        raise RuntimeError(err_msg)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    last_exc: Exception = RuntimeError("No attempts made")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()

            if not data or len(data.strip()) == 0:
                empty_err = f"Пустой ответ от Google Sheets (0 байт) при экспорте: {url[:80]}"
                record_sync_error("EMPTY_RESPONSE", empty_err, url=url, attempt=attempt)
                raise ValueError(empty_err)

            _circuit_breaker.record_success()
            if attempt > 1:
                logger.info(f"Успешная загрузка Google Sheets на попытке {attempt}: {url[:80]}")
            return data

        except urllib.error.HTTPError as http_err:
            last_exc = http_err
            category = f"HTTP_{http_err.code}"

            if http_err.code in (401, 403):
                category = "HTTP_403_FORBIDDEN"
                msg = f"Доступ закрыт или отозван (HTTP {http_err.code}). Проверьте публичные права таблицы."
                record_sync_error(category, msg, url=url, http_status=http_err.code, attempt=attempt)
                logger.critical(f"🚨 КРИТИЧЕСКАЯ ОШИБКА ДОСТУПА: {msg} {url[:80]}")
                break  # Бесполезно ретраить при 401/403
            elif http_err.code in (404, 410):
                category = "HTTP_404_NOT_FOUND"
                msg = f"Таблица не найдена (HTTP {http_err.code}). Проверьте ID таблицы."
                record_sync_error(category, msg, url=url, http_status=http_err.code, attempt=attempt)
                logger.critical(f"🚨 КРИТИЧЕСКАЯ ОШИБКА: {msg} {url[:80]}")
                break  # Бесполезно ретраить при 404
            elif http_err.code == 429:
                category = "HTTP_429_RATE_LIMIT"
                msg = f"Превышен лимит запросов к Google Sheets (HTTP 429 Rate Limit)."
                record_sync_error(category, msg, url=url, http_status=http_err.code, attempt=attempt)
                logger.warning(f"⚠️ {msg} Попытка {attempt}/{retries}")
            elif http_err.code >= 500:
                category = f"HTTP_{http_err.code}_SERVER_ERROR"
                msg = f"Серверная ошибка Google Sheets (HTTP {http_err.code})."
                record_sync_error(category, msg, url=url, http_status=http_err.code, attempt=attempt)
            else:
                record_sync_error(category, f"HTTP ошибка {http_err.code}: {http_err.reason}", url=url, http_status=http_err.code, attempt=attempt)

            wait = 2 ** attempt
            if attempt < retries:
                logger.warning(f"HTTP {http_err.code} на попытке {attempt}/{retries}, повтор через {wait}с")
                time.sleep(wait)

        except Exception as exc:
            last_exc = exc
            exc_str = str(exc)
            category = "NETWORK_ERROR"

            if isinstance(exc, (TimeoutError, socket.timeout)) or "timed out" in exc_str.lower():
                category = "TIMEOUT"
                msg = f"Таймаут ожидания ответа от Google Sheets ({timeout} сек): {exc_str}"
            elif "getaddrinfo failed" in exc_str or "name or service not known" in exc_str.lower():
                category = "DNS_FAILURE"
                msg = f"Сбой разрешения доменного имени Google: {exc_str}"
            elif "connection reset" in exc_str.lower() or "connection refused" in exc_str.lower():
                category = "CONNECTION_RESET"
                msg = f"Сброс соединения удалённым сервером: {exc_str}"
            elif isinstance(exc, ValueError) and "Пустой ответ" in exc_str:
                category = "EMPTY_RESPONSE"
                msg = exc_str
            else:
                msg = f"Сбой сетевого подключения: {exc_str}"

            record_sync_error(category, msg, url=url, attempt=attempt)
            wait = 2 ** attempt
            if attempt < retries:
                logger.warning(f"Попытка {attempt}/{retries} не удалась [{category}] ({msg}), повтор через {wait}с: {url[:80]}")
                time.sleep(wait)
            else:
                logger.error(f"Все {retries} попытки исчерпаны [{category}]: {url[:80]} — {msg}")

    _circuit_breaker.record_failure()
    raise last_exc


# ─────────────────────────────────────────────
#  Тестовые вкладки и known_tabs.json
# ─────────────────────────────────────────────
def is_test_tab(name: Optional[str]) -> bool:
    """Проверка, является ли вкладка тестовой, служебной или черновиком."""
    if not name:
        return False
    lower = str(name).strip().lower()
    patterns = [
        r"тест",
        r"test",
        r"draft",
        r"черновик",
        r"шаблон",
        r"\btemp\b",
        r"sample",
        r"^лист\s*\d*$",
        r"^sheet\s*\d*$",
    ]
    return any(re.search(p, lower) for p in patterns)


def _load_known_tabs() -> List[Dict[str, Any]]:
    """Читает все когда-либо найденные вкладки из known_tabs.json (исключая тестовые)."""
    if not os.path.exists(KNOWN_TABS_FILE):
        return []
    try:
        with open(KNOWN_TABS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        tabs = data.get("tabs", [])
        clean_tabs = [t for t in tabs if not is_test_tab(t.get("name"))]
        logger.info(f"known_tabs.json: загружено {len(clean_tabs)} известных вкладок")
        return clean_tabs
    except Exception as e:
        logger.warning(f"Не удалось прочитать known_tabs.json: {e}")
        return []


def _save_known_tabs(new_tabs: List[Dict[str, Any]]) -> None:
    """Добавляет новые вкладки в known_tabs.json (не дублирует по GID и не сохраняет тестовые)."""
    existing = _load_known_tabs()
    existing_gids = {t["gid"] for t in existing}
    added = 0
    for tab in new_tabs:
        name = tab.get("name", "")
        if is_test_tab(name):
            continue
        if tab["gid"] not in existing_gids:
            existing.append({
                "gid": tab["gid"],
                "name": name,
                "discovered_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            })
            existing_gids.add(tab["gid"])
            added += 1
    if added:
        try:
            with open(KNOWN_TABS_FILE, "w", encoding="utf-8") as f:
                json.dump({"tabs": existing, "updated": datetime.now().strftime("%Y-%m-%d %H:%M")},
                          f, ensure_ascii=False, indent=2)
            logger.info(f"known_tabs.json: добавлено {added} новых вкладок (всего {len(existing)})")
        except Exception as e:
            logger.warning(f"Не удалось сохранить known_tabs.json: {e}")

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
        target_date = get_moscow_now()
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

    # Код дисциплины выводится как часть полного названия предмета:
    subject_name = subject_raw

    return code, subject_name, get_full_teacher_name(teacher)


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
    zamena_direct_match = re.match(r"^(\d{1,2}\.\d{1,2})?\s*замена\s+(.+)$", text, re.IGNORECASE | re.DOTALL)
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
    elif zamena_direct_match:
        # Пары вида: "03.09 замена ОП.02 Физика Новиков Д.В."
        date_str = zamena_direct_match.group(1) or ""
        lesson_text = zamena_direct_match.group(2).strip()
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


def extract_spreadsheet_id(url_or_id: str) -> str:
    """Извлечение ID таблицы из полного URL или строки."""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    return url_or_id.strip()


def parse_tab_parity(tab_name: str) -> Optional[str]:
    """Извлекает тип недели (числитель/знаменатель) из названия вкладки.
    Возвращает 'num' для числителя, 'den' для знаменателя или None, если тип не указан.
    """
    if not tab_name:
        return None
    t_lower = tab_name.lower()
    if "числитель" in t_lower:
        return "num"
    elif "знаменатель" in t_lower:
        return "den"
    return None


def check_parity_override(tab_name: str) -> Optional[bool]:
    """Проверяет, указана ли четность недели прямо в названии вкладки."""
    p = parse_tab_parity(tab_name)
    if p == "num":
        return True
    elif p == "den":
        return False
    return None


# Fallback-вкладки — обновляй этот список каждую неделю!
# Формат: {"name": "<название вкладки>", "gid": "<GID из URL Google Sheets>"}
KNOWN_FALLBACK_SHEETS = [
    {"name": "02.09-05.09 (Числитель -вверх)", "gid": "390445764"},
    {"name": "Основное", "gid": "502140416"},
]


def _discover_via_htmlview(spreadsheet_id: str) -> List[Dict[str, Any]]:
    """Метод 1: обнаружение вкладок через htmlview (парсинг HTML)."""
    html_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/htmlview"
    req = urllib.request.Request(
        html_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0"
            )
        },
    )
    sheets = []
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    # Попытка 1: items.push({name:"...", gid:"..."})
    pattern = r'items\.push\(\{\s*name:\s*"([^"]+)"[^}]+gid:\s*"([^"]+)"'
    raw_matches = re.findall(pattern, html)
    for name, gid in raw_matches:
        name_clean = name.replace(r"\'", "'").replace(r'\"', '"').strip()
        sheets.append({"name": name_clean, "gid": str(gid)})
    if sheets:
        return sheets
    # Попытка 2: data-sheet-id и aria-label (новая структура Google Sheets)
    pattern2 = r'data-sheet-id="(\d+)"[^>]*aria-label="([^"]+)"'
    raw_matches2 = re.findall(pattern2, html)
    for gid, name in raw_matches2:
        sheets.append({"name": name.strip(), "gid": str(gid)})
    if sheets:
        return sheets
    # Попытка 3: sheetnames массив в JS
    pattern3 = r'"sheetnames"\s*:\s*\[([^\]]+)\]'
    sn_match = re.search(pattern3, html)
    pattern_gid = r'"gid=(\d+)"'
    gid_matches = re.findall(pattern_gid, html)
    if sn_match and gid_matches:
        names_raw = re.findall(r'"([^"]+)"', sn_match.group(1))
        for i, gid in enumerate(gid_matches[:len(names_raw)]):
            sheets.append({"name": names_raw[i], "gid": gid})
    if sheets:
        return sheets
    # Попытка 4: собираем ВСЕ уникальные gid= из HTML + сливаем с KNOWN_FALLBACK_SHEETS
    all_gids_in_html = list(dict.fromkeys(re.findall(r'\bgid=(\d+)', html)))
    known_gid_map = {s["gid"]: s["name"] for s in KNOWN_FALLBACK_SHEETS}
    for gid in all_gids_in_html:
        name = known_gid_map.get(gid, f"Вкладка {gid}")
        sheets.append({"name": name, "gid": gid})
    return sheets


def discover_sheets(spreadsheet_id: str) -> List[Dict[str, Any]]:
    """Динамическое обнаружение всех вкладок таблицы.
    Использует метод htmlview.
    При полном провале возвращает кэш known_tabs.json или жёстко прописанный KNOWN_FALLBACK_SHEETS.
    """
    sheets_htmlview: List[Dict[str, Any]] = []

    try:
        sheets_htmlview = _discover_via_htmlview(spreadsheet_id)
        logger.info(f"htmlview нашёл {len(sheets_htmlview)} вкладок")
    except Exception as e:
        logger.warning(f"Метод htmlview не сработал: {e}")

    if sheets_htmlview:
        best = sheets_htmlview
    else:
        # Полный fallback: сначала known_tabs.json, затем KNOWN_FALLBACK_SHEETS
        known = _load_known_tabs()
        if known:
            logger.warning("htmlview не сработал — используем known_tabs.json")
            return [{"gid": t["gid"], "name": t["name"]} for t in known]
        logger.warning("htmlview не сработал — используем KNOWN_FALLBACK_SHEETS")
        return list(KNOWN_FALLBACK_SHEETS)

    found_gids = {s["gid"] for s in best}

    # Подмешиваем вкладки из known_tabs.json (накоплены за весь год)
    for kt in _load_known_tabs():
        if kt["gid"] not in found_gids:
            best.append({"gid": kt["gid"], "name": kt["name"]})
            found_gids.add(kt["gid"])
            logger.info(f"Добавлена вкладка из known_tabs: {kt['name']} (gid={kt['gid']})")

    # Подмешиваем KNOWN_FALLBACK_SHEETS для гарантии «Основное» и т.д.
    for fallback_sheet in KNOWN_FALLBACK_SHEETS:
        if fallback_sheet["gid"] not in found_gids:
            best.append(dict(fallback_sheet))
            found_gids.add(fallback_sheet["gid"])
            logger.info(f"Добавлена вкладка из fallback: {fallback_sheet['name']} (gid={fallback_sheet['gid']})")

    # Исключаем любые тестовые вкладки из результатов обнаружения
    clean_best = [s for s in best if not is_test_tab(s.get("name"))]

    # Сохраняем все найденные вкладки в known_tabs.json для будущих запусков
    _save_known_tabs(clean_best)

    return clean_best


DATE_RANGE_REGEX = re.compile(r"(\d{1,2})\.(\d{1,2})\s*(?:[-–—]|по|до)\s*(\d{1,2})\.(\d{1,2})", re.IGNORECASE)


def parse_tab_date_range(tab_name: str, base_date: Optional[datetime] = None) -> Optional[Tuple[datetime, datetime]]:
    """Извлекает диапазон дат (начало, конец) из названия вкладки.
    Возвращает кортеж (start_datetime, end_datetime) или None, если диапазон не найден.
    Исключает вкладки без диапазона дат (например «Основное», «Расписание 1 сентября»).
    """
    if not tab_name:
        return None
    m = DATE_RANGE_REGEX.search(tab_name)
    if not m:
        return None
    try:
        if base_date is None:
            base_date = get_moscow_now()
        d1, m1, d2, m2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        # Определение года с учетом учебного календаря (сентябрь - июнь)
        if base_date.month >= 8:
            y1 = base_date.year if m1 >= 8 else base_date.year + 1
            y2 = base_date.year if m2 >= 8 else base_date.year + 1
        else:
            y1 = base_date.year - 1 if m1 >= 8 else base_date.year
            y2 = base_date.year - 1 if m2 >= 8 else base_date.year

        start_dt = datetime(y1, m1, d1, 0, 0, 0)
        end_dt = datetime(y2, m2, d2, 23, 59, 59)
        if end_dt < start_dt:
            end_dt = datetime(y2 + 1, m2, d2, 23, 59, 59)
        return start_dt, end_dt
    except Exception as e:
        logger.debug(f"Ошибка вычисления дат вкладки '{tab_name}': {e}")
        return None


def determine_active_tab(sheets: List[Dict[str, Any]], target_date: Optional[datetime] = None) -> str:
    """Выбор gid активной вкладки с максимальной защитой и авто-сопоставлением дат.
    1. Проверяет ручной FORCED_TAB_GID из .env.
    2. Ищет вкладку с диапазоном дат для текущего дня (или для понедельника, если сегодня воскресенье).
    3. Если точного совпадения нет — выбирает вкладку с самыми свежими датами.
    4. Если дат в названиях нет — выбирает вкладку, отличную от «Основное».
    """
    valid_sheets = [s for s in sheets if not is_test_tab(s.get("name"))]
    if not valid_sheets:
        valid_sheets = sheets
    if not valid_sheets:
        return ""

    forced_gid = os.getenv("FORCED_TAB_GID", "").strip()
    if forced_gid:
        for s in valid_sheets:
            if s["gid"] == forced_gid or s["name"].lower() == forced_gid.lower():
                return s["gid"]

    if target_date is None:
        target_date = get_moscow_now()

    check_dates = [target_date]
    if target_date.weekday() == 6:  # Воскресенье
        check_dates.append(target_date + timedelta(days=1))

    parsed_date_tabs = []

    for s in valid_sheets:
        name = s["name"]
        dr = parse_tab_date_range(name, target_date)
        if dr:
            start_dt, end_dt = dr
            tab_parity = parse_tab_parity(name)
            parsed_date_tabs.append({
                "gid": s["gid"],
                "name": name,
                "start": start_dt,
                "end": end_dt,
                "parity": tab_parity,
            })

    for c_dt in check_dates:
        target_parity = get_academic_week_info(c_dt)["parity"]
        matching = [
            t for t in parsed_date_tabs
            if t["start"] <= c_dt <= t["end"]
        ]
        if matching:
            # 1. Точное совпадение: диапазон дат + тип недели (числитель/знаменатель)
            for t in matching:
                if t["parity"] == target_parity:
                    return t["gid"]
            # 2. Fallback: вкладка без указания типа недели (None / null)
            for t in matching:
                if t["parity"] is None:
                    return t["gid"]
            # 3. Fallback: первая подходящая по дате вкладка
            return matching[0]["gid"]

    # Если точного совпадения по дате нет, сортируем датированные вкладки и берем самую свежую
    if parsed_date_tabs:
        parsed_date_tabs.sort(key=lambda x: x["start"])
        return parsed_date_tabs[-1]["gid"]

    non_main = [s["gid"] for s in valid_sheets if "основное" not in s["name"].lower()]
    if non_main:
        return non_main[0]

    return valid_sheets[0]["gid"]


def validate_schedule_data(data: Dict[str, Any]) -> Tuple[bool, str]:
    """Проверяет валидность полученного расписания перед сохранением в кэш.
    Возвращает (is_valid, reason).
    """
    if not isinstance(data, dict):
        return False, "Данные не являются словарем"
    schedules = data.get("schedules")
    if not schedules or not isinstance(schedules, dict):
        return False, "Отсутствует блок schedules"
    if len(schedules) == 0:
        return False, "Список групп пуст (0 групп)"

    total_lessons = 0
    for g_data in schedules.values():
        for pairs in g_data.get("days", {}).values():
            for p in pairs:
                if not p.get("is_empty"):
                    total_lessons += 1

    if total_lessons == 0:
        return False, "Во всей таблице не найдено ни одного учебного занятия (0 пар)"

    return True, f"OK ({len(schedules)} групп, {total_lessons} пар)"


class ScheduleParser:
    def __init__(self, sheet_url: str = DEFAULT_SHEET_URL, cache_file: str = CACHE_FILE):
        self.sheet_url = os.getenv("SHEET_URL", sheet_url)
        self.spreadsheet_id = extract_spreadsheet_id(self.sheet_url)
        self.cache_file = cache_file
        self.available_tabs: List[Dict[str, Any]] = []
        # Дефолтный active_gid: берём из known_tabs.json если есть, иначе пустая строка.
        # Жёстко прописанный GID не используем — он устаревает каждую неделю.
        known = _load_known_tabs()
        self.active_gid: str = known[0]["gid"] if known else ""
        self.sheets_cache: Dict[str, Dict[str, Any]] = {}
        self.last_tabs_check: float = 0
        self.last_updated: float = 0

        self.load_cache()
        self.refresh_tabs()

    @property
    def data(self) -> Optional[Dict[str, Any]]:
        """Для обратной совместимости: данные активной вкладки."""
        if self.active_gid in self.sheets_cache:
            return self.sheets_cache[self.active_gid]
        if self.sheets_cache:
            return next(iter(self.sheets_cache.values()))
        return None

    def get_sync_errors(self) -> List[Dict[str, Any]]:
        """Возвращает историю последних ошибок синхронизации Google Sheets."""
        return get_sync_errors()

    def refresh_tabs(self, force: bool = False) -> List[Dict[str, Any]]:
        """Обновление списка вкладок, сопоставление диапазонов дат и определение активной недели."""
        now = time.time()
        if not force and self.available_tabs and (now - self.last_tabs_check < 120):
            return self.available_tabs

        raw_tabs = [t for t in discover_sheets(self.spreadsheet_id) if not is_test_tab(t.get("name"))]
        now_msk = get_moscow_now()
        active_gid = determine_active_tab(raw_tabs, now_msk)
        self.active_gid = active_gid

        tabs_formatted = []
        for t in raw_tabs:
            gid = t["gid"]
            name = t["name"]
            is_active = (gid == active_gid)
            date_range = parse_tab_date_range(name, now_msk)
            has_range = (date_range is not None)
            start_iso = date_range[0].isoformat() if date_range else None
            end_iso = date_range[1].isoformat() if date_range else None
            date_start = date_range[0].strftime("%Y-%m-%d") if date_range else None
            date_end = date_range[1].strftime("%Y-%m-%d") if date_range else None
            start_dm = date_range[0].strftime("%d.%m") if date_range else None
            end_dm = date_range[1].strftime("%d.%m") if date_range else None

            tab_parity = parse_tab_parity(name)
            tabs_formatted.append({
                "name": name,
                "gid": gid,
                "is_active": is_active,
                "is_main": ("основное" in name.lower()),
                "parity": tab_parity,
                "has_date_range": has_range,
                "date_start": date_start,
                "date_end": date_end,
                "start_dm": start_dm,
                "end_dm": end_dm,
                "start_iso": start_iso,
                "end_iso": end_iso,
            })

        self.available_tabs = tabs_formatted
        self.last_tabs_check = now
        return tabs_formatted

    def find_tab_for_date(self, target_date: Any) -> Optional[Dict[str, Any]]:
        """Ищет вкладку с датированным диапазоном, в который попадает заданная дата, с приоритетом по типу недели."""
        if isinstance(target_date, str):
            try:
                target_date = datetime.fromisoformat(target_date)
            except Exception:
                target_date = get_moscow_now()
        elif isinstance(target_date, date) and not isinstance(target_date, datetime):
            target_date = datetime.combine(target_date, datetime.min.time())

        target_parity = get_academic_week_info(target_date)["parity"]
        self.refresh_tabs()

        matching_tabs = []
        for t in self.available_tabs:
            if not t.get("has_date_range"):
                continue
            s_iso = t.get("start_iso")
            e_iso = t.get("end_iso")
            if s_iso and e_iso:
                dt1 = datetime.fromisoformat(s_iso)
                dt2 = datetime.fromisoformat(e_iso)
                if dt1 <= target_date <= dt2:
                    matching_tabs.append(t)

        if not matching_tabs:
            return None

        # 1. Точное совпадение: диапазон дат + тип недели (числитель/знаменатель)
        for t in matching_tabs:
            if t.get("parity") == target_parity:
                return t

        # 2. Fallback: вкладка без указания типа недели (None / null)
        for t in matching_tabs:
            if t.get("parity") is None:
                return t

        # 3. Fallback: первая подходящая по дате вкладка
        return matching_tabs[0]

    def find_tab_for_week_range(self, monday: Any, saturday: Any) -> Optional[Dict[str, Any]]:
        """Ищет вкладку, диапазон дат которой пересекается с учебной неделей Пн-Сб, с приоритетом по типу недели."""
        if isinstance(monday, str):
            monday = datetime.fromisoformat(monday)
        elif isinstance(monday, date) and not isinstance(monday, datetime):
            monday = datetime.combine(monday, datetime.min.time())

        if isinstance(saturday, str):
            saturday = datetime.fromisoformat(saturday)
        elif isinstance(saturday, date) and not isinstance(saturday, datetime):
            saturday = datetime.combine(saturday, datetime.max.time())

        target_parity = get_academic_week_info(monday)["parity"]
        self.refresh_tabs()

        matching_tabs = []
        for t in self.available_tabs:
            if not t.get("has_date_range"):
                continue
            s_iso = t.get("start_iso")
            e_iso = t.get("end_iso")
            if s_iso and e_iso:
                dt1 = datetime.fromisoformat(s_iso)
                dt2 = datetime.fromisoformat(e_iso)
                if monday <= dt2 and saturday >= dt1:
                    matching_tabs.append(t)

        if not matching_tabs:
            return None

        # 1. Приоритет совпадения типа недели
        for t in matching_tabs:
            if t.get("parity") == target_parity:
                return t

        # 2. Fallback: без указания типа недели
        for t in matching_tabs:
            if t.get("parity") is None:
                return t

        # 3. Любая подходящая по дате
        return matching_tabs[0]

    def get_tabs(self) -> Dict[str, Any]:
        """Получить список всех доступных вкладок с пометкой активной."""
        self.refresh_tabs()
        return {
            "tabs": self.available_tabs,
            "active_gid": self.active_gid,
        }

    def _resolve_gid(self, gid: Optional[str]) -> str:
        """Преобразует имя вкладки или None в числовой GID."""
        if not gid or gid == "active":
            return self.active_gid

        gid_str = str(gid).strip()
        for t in self.available_tabs:
            if t["gid"] == gid_str:
                return gid_str
            if t["name"].lower() == gid_str.lower():
                return t["gid"]

        return gid_str

    def fetch_csv(self, gid: Optional[str] = None) -> str:
        """Загрузка живой таблицы через Google Sheets export (с retry и CircuitBreaker)."""
        target_gid = self._resolve_gid(gid)
        csv_url = (
            f"https://docs.google.com/spreadsheets/d/{self.spreadsheet_id}"
            f"/export?format=csv&gid={target_gid}"
        )
        logger.info(f"Загрузка вкладки [gid={target_gid}]")
        return fetch_with_retry(csv_url, retries=3, timeout=25).decode("utf-8")

    def _build_empty_schedule(self, tab_name: str, gid: str) -> Dict[str, Any]:
        """Безопасная заглушка расписания для новых или нестандартных вкладок (предотвращает сбои бэкенда)."""
        clean_tabs = [t for t in self.available_tabs if not is_test_tab(t.get("name"))]
        current_week = get_academic_week_info()
        return {
            "title": "Колледж телекоммуникаций",
            "tab_name": tab_name,
            "gid": gid,
            "is_active_tab": (gid == self.active_gid),
            "available_tabs": clean_tabs,
            "active_gid": self.active_gid,
            "subtitle": f"Расписание учебных занятий • {tab_name}",
            "last_updated": datetime.now().strftime("%d.%m.%Y %H:%M:%S"),
            "timestamp": time.time(),
            "groups_count": 0,
            "groups": [],
            "courses": ["1 курс", "2 курс", "3 курс", "4 курс", "Очно-заочное"],
            "day_dates": {},
            "schedules": {},
            "teachers": [],
            "teacher_schedules": {},
            "classrooms": [],
            "classroom_schedules": {},
            "bell_times": BELL_TIMES,
            "break_times": BREAK_TIMES,
            "week_info": current_week,
            "stale": False,
        }

    def parse(self, raw_csv: Optional[str] = None, gid: Optional[str] = None) -> Dict[str, Any]:
        """Парсинг CSV в структурированный JSON с полной защитой от сбоев."""
        target_gid = self._resolve_gid(gid)
        if raw_csv is None:
            raw_csv = self.fetch_csv(target_gid)

        tab_name = ""
        for t in self.available_tabs:
            if t["gid"] == target_gid:
                tab_name = t["name"]
                break
        if not tab_name:
            tab_name = "Актуальное расписание" if target_gid == self.active_gid else f"Вкладка {target_gid}"

        try:
            return self._parse_internal(raw_csv, target_gid, tab_name)
        except Exception as e:
            logger.error(f"Неожиданная ошибка парсинга вкладки '{tab_name}' (gid={target_gid}): {e}", exc_info=True)
            return self._build_empty_schedule(tab_name, target_gid)

    def _parse_internal(self, raw_csv: str, target_gid: str, tab_name: str) -> Dict[str, Any]:
        reader = list(csv.reader(io.StringIO(raw_csv)))
        if len(reader) < 6:
            logger.warning(f"Вкладка '{tab_name}' содержит мало строк ({len(reader)}) — возвращаем безопасную структуру")
            return self._build_empty_schedule(tab_name, target_gid)

        # Поиск строки групп и курсов
        courses_row_idx = 3
        groups_row_idx = 4
        found_groups = False

        for idx, r in enumerate(reader[:15]):
            if any("9-" in c or "11-" in c or "гр." in c.lower() or "группа" in c.lower() for c in r):
                groups_row_idx = idx
                courses_row_idx = max(0, idx - 1)
                found_groups = True
                break

        if groups_row_idx >= len(reader):
            logger.warning(f"Вкладка '{tab_name}': строка групп не найдена")
            return self._build_empty_schedule(tab_name, target_gid)

        courses_row = reader[courses_row_idx] if courses_row_idx < len(reader) else []
        groups_row = reader[groups_row_idx] if groups_row_idx < len(reader) else []

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
            try:
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

                        if top_obj and not bot_obj:
                            is_both = True
                        elif not top_obj and bot_obj:
                            is_both = True
                            top_obj = bot_obj
                            bot_obj = None
                        elif top_obj and bot_obj:
                            if top_text == bot_text and top_aud == bot_aud:
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
            except Exception as g_err:
                logger.warning(f"Ошибка парсинга группы '{group_name}' во вкладке '{tab_name}': {g_err}")

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
        parity_override = check_parity_override(tab_name)
        if parity_override is not None:
            current_week["is_numerator"] = parity_override
            current_week["parity"] = "num" if parity_override else "den"
            current_week["parity_name"] = "Числитель (I)" if parity_override else "Знаменатель (II)"

        result = {
            "title": "Колледж телекоммуникаций",
            "tab_name": tab_name,
            "gid": target_gid,
            "is_active_tab": (target_gid == self.active_gid),
            "available_tabs": self.available_tabs,
            "active_gid": self.active_gid,
            "subtitle": f"Расписание учебных занятий • {tab_name}",
            "last_updated": get_moscow_now().strftime("%d.%m.%Y %H:%M:%S"),
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

        # Атомарная валидация перед сохранением и заменой
        is_valid, val_reason = validate_schedule_data(result)
        prev_data = self.sheets_cache.get(target_gid)

        if not is_valid:
            if prev_data and prev_data.get("groups_count", 0) > 0:
                logger.warning(
                    f"⚠️ Отбракованы подозрительные/пустые данные вкладки '{tab_name}' ({val_reason}). "
                    f"Сохраняем предыдущую валидную версию ({prev_data.get('groups_count')} групп)."
                )
                prev_data["stale"] = True
                prev_data["stale_reason"] = f"Таблица временно пуста или повреждена ({val_reason}). Показана сохранённая версия."
                return prev_data
            else:
                logger.warning(f"Данные вкладки '{tab_name}' не прошли валидацию ({val_reason}), но предыдущей версии в памяти нет.")

        self.sheets_cache[target_gid] = result
        self.last_updated = time.time()
        self.save_cache()
        return result

    def save_cache(self) -> None:
        """Сохранение кэша всех вкладок в файл (исключая тестовые) атомарно через временный файл."""
        try:
            clean_tabs = [t for t in self.available_tabs if not is_test_tab(t.get("name"))]
            clean_sheets = {}
            for g, s in self.sheets_cache.items():
                if is_test_tab(s.get("tab_name")):
                    continue
                s_copy = dict(s)
                if "available_tabs" in s_copy:
                    s_copy["available_tabs"] = [t for t in s_copy["available_tabs"] if not is_test_tab(t.get("name"))]
                clean_sheets[g] = s_copy

            payload = {
                "available_tabs": clean_tabs,
                "active_gid": self.active_gid,
                "last_updated": self.last_updated,
                "sheets": clean_sheets,
            }
            tmp_file = f"{self.cache_file}.tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            os.replace(tmp_file, self.cache_file)
            logger.info(f"Кэш сохранён в {self.cache_file} ({len(clean_sheets)} вкладок)")
        except Exception as e:
            logger.error(f"Ошибка сохранения кэша: {e}")

    def load_cache(self) -> Optional[Dict[str, Any]]:
        """Загрузка кэша из файла (исключая тестовые вкладки)."""
        if not os.path.exists(self.cache_file):
            return None
        try:
            mtime = os.path.getmtime(self.cache_file)
            with open(self.cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            if "sheets" in data:
                clean_sheets = {}
                for g, s in data["sheets"].items():
                    if is_test_tab(s.get("tab_name")):
                        continue
                    if "available_tabs" in s:
                        s["available_tabs"] = [t for t in s["available_tabs"] if not is_test_tab(t.get("name"))]
                    clean_sheets[g] = s
                self.sheets_cache = clean_sheets
                raw_tabs = data.get("available_tabs", [])
                self.available_tabs = [t for t in raw_tabs if not is_test_tab(t.get("name"))]
                self.active_gid = data.get("active_gid", self.active_gid)
                self.last_updated = data.get("last_updated", mtime)
                return self.sheets_cache.get(self.active_gid)
            elif "schedules" in data:
                if not is_test_tab(data.get("tab_name")):
                    self.sheets_cache[self.active_gid] = data
                self.last_updated = mtime
                return data
            return None
        except Exception as e:
            logger.error(f"Ошибка чтения кэша: {e}")
            return None

    def get_data(self, gid: Optional[str] = None, force_refresh: bool = False) -> Dict[str, Any]:
        """Получение данных для конкретной вкладки. Никогда не падает — 4 уровня защиты:
        1. Свежий кэш (< CACHE_TTL_SECONDS) — возвращаем моментально.
        2. Живые данные из Google Sheets — парсим и кэшируем.
        3. Устаревший кэш этой вкладки — возвращаем с флагом stale=True.
        4. Любые данные из sheets_cache — возвращаем с флагом stale=True.
        """
        try:
            self.refresh_tabs(force=force_refresh)
        except Exception as e:
            logger.warning(f"refresh_tabs не удался: {e} — продолжаем с текущим списком вкладок")

        target_gid = self._resolve_gid(gid)
        cached_sheet = self.sheets_cache.get(target_gid)
        now = time.time()

        # Уровень 1: свежий кэш
        if not force_refresh and cached_sheet:
            age = now - cached_sheet.get("timestamp", 0)
            if age < CACHE_TTL_SECONDS:
                cached_sheet["available_tabs"] = self.available_tabs
                cached_sheet["active_gid"] = self.active_gid
                cached_sheet["stale"] = False
                return enrich_schedule_teachers(cached_sheet)

        # Уровень 2: живые данные из Google
        try:
            result = self.parse(gid=target_gid)
            result["stale"] = False
            return enrich_schedule_teachers(result)
        except Exception as e:
            logger.error(f"Ошибка получения живых данных gid={target_gid}: {e}")

        # Уровень 3: устаревший кэш именно этой вкладки
        if cached_sheet:
            age_min = int((now - cached_sheet.get("timestamp", now)) / 60)
            logger.warning(f"Уровень 3: устаревший кэш вкладки {target_gid} (возраст ~{age_min} мин)")
            cached_sheet["available_tabs"] = self.available_tabs
            cached_sheet["active_gid"] = self.active_gid
            cached_sheet["stale"] = True
            cached_sheet["stale_reason"] = f"Нет связи с Google Sheets, данные {age_min} мин назад"
            return enrich_schedule_teachers(cached_sheet)

        # Уровень 4: любые данные из sheets_cache
        if self.sheets_cache:
            fallback = (
                self.sheets_cache.get(self.active_gid)
                or next(iter(self.sheets_cache.values()))
            )
            age_min = int((now - fallback.get("timestamp", now)) / 60)
            logger.warning(f"Уровень 4: другая вкладка из кэша (возраст ~{age_min} мин)")
            fallback = dict(fallback)  # копия чтобы не мутировать кэш
            fallback["available_tabs"] = self.available_tabs
            fallback["active_gid"] = self.active_gid
            fallback["stale"] = True
            fallback["stale_reason"] = f"Нет связи с Google Sheets, резервные данные {age_min} мин назад"
            return enrich_schedule_teachers(fallback)

        # Если кэша нет вообще — бросаем понятное исключение
        raise RuntimeError(
            "Нет данных расписания: кэш пуст и Google Sheets недоступен. "
            "Дождитесь восстановления соединения или перезапустите сервер."
        )

    def get_upcoming_alarm(self, group_name: str, pattern: str = r"(англ|иностр)") -> Dict[str, Any]:
        """Быстрый и безошибочный поиск ближайшей пары (по умолчанию: английский/иностранный язык)
        для указанной группы по всем доступным вкладкам с расчетом точного обратного отсчета по МСК.
        """
        now = get_moscow_now()
        self.refresh_tabs()

        regex = re.compile(pattern, re.IGNORECASE)
        candidates = []

        tabs_to_check = []
        if self.active_gid:
            tabs_to_check.append(self.active_gid)
        for t in self.available_tabs:
            if t["gid"] not in tabs_to_check:
                tabs_to_check.append(t["gid"])

        for gid in tabs_to_check:
            try:
                sheet_data = self.get_data(gid=gid)
            except Exception as ex:
                logger.debug(f"Ошибка загрузки вкладки {gid} для будильника: {ex}")
                continue

            schedules = sheet_data.get("schedules", {})
            if not schedules:
                continue

            g_data = schedules.get(group_name)
            if not g_data:
                for g_k, g_v in schedules.items():
                    if g_k.lower() == group_name.lower():
                        g_data = g_v
                        group_name = g_k
                        break
            if not g_data:
                continue

            day_dates = sheet_data.get("day_dates", {})
            days_dict = g_data.get("days", {})
            year = now.year if now.month >= 8 else now.year - 1

            for day_name, pairs in days_dict.items():
                dm = day_dates.get(day_name, "")
                d, m = None, None
                if dm and "." in dm:
                    parts = dm.split(".")
                    try:
                        d, m = int(parts[0]), int(parts[1])
                    except Exception:
                        pass

                if d is None or m is None:
                    dr = parse_tab_date_range(sheet_data.get("tab_name", ""), now)
                    if dr:
                        day_idx = DAYS_ORDER.index(day_name) if day_name in DAYS_ORDER else -1
                        if day_idx >= 0:
                            day_dt = dr[0] + timedelta(days=day_idx)
                            d, m = day_dt.day, day_dt.month

                if d is None or m is None:
                    continue

                pair_year = year if m >= 8 else year + 1

                for p in pairs:
                    if p.get("is_empty"):
                        continue
                    p_num = p.get("pair_num", 1)

                    tab_parity = sheet_data.get("week_info", {}).get("parity")
                    if tab_parity == "num":
                        pair_options = [p.get("both"), p.get("numerator")]
                    elif tab_parity == "den":
                        pair_options = [p.get("both"), p.get("denominator")]
                    else:
                        pair_options = [p.get("both"), p.get("numerator"), p.get("denominator")]

                    for opt in pair_options:
                        if not opt or opt.get("is_cancelled"):
                            continue
                        subj = opt.get("subject", "")
                        if regex.search(subj):
                            bell = BELL_TIMES.get(p_num) or BELL_TIMES.get(str(p_num)) or {}
                            bell_start = bell.get("start", "08:30")
                            bell_end = bell.get("end", "10:05")
                            time_display = f"{bell_start} - {bell_end}"

                            sh, sm = map(int, bell_start.split(":"))
                            eh, em = map(int, bell_end.split(":"))

                            start_dt = datetime(pair_year, m, d, sh, sm, 0)
                            end_dt = datetime(pair_year, m, d, eh, em, 0)

                            if end_dt > now:
                                diff = start_dt - now
                                is_going_now = (start_dt <= now < end_dt)
                                total_sec = max(0, int(diff.total_seconds()))

                                candidates.append({
                                    "target_dt": start_dt,
                                    "end_dt": end_dt,
                                    "is_going_now": is_going_now,
                                    "diff_seconds": total_sec,
                                    "group": group_name,
                                    "day_name": day_name,
                                    "date_formatted": f"{d:02d}.{m:02d}.{pair_year}",
                                    "display_date": f"{day_name}, {d:02d}.{m:02d}.{pair_year}",
                                    "pair_num": p_num,
                                    "time": time_display,
                                    "subject": subj,
                                    "teacher": opt.get("teacher", ""),
                                    "classroom": opt.get("classroom", ""),
                                })
                                break

        if not candidates:
            return {
                "found": False,
                "group": group_name,
                "message": "В расписании группы пар иностранного языка не найдено"
            }

        candidates.sort(key=lambda x: x["target_dt"])
        best = candidates[0]

        total_sec = best["diff_seconds"]
        days_left = total_sec // 86400
        hours_left = (total_sec % 86400) // 3600
        mins_left = (total_sec % 3600) // 60
        secs_left = total_sec % 60

        return {
            "found": True,
            "group": best["group"],
            "day_name": best["day_name"],
            "date_formatted": best["date_formatted"],
            "display_date": best["display_date"],
            "pair_num": best["pair_num"],
            "time": best["time"],
            "subject": best["subject"],
            "teacher": best["teacher"],
            "classroom": best["classroom"],
            "target_iso": best["target_dt"].isoformat(),
            "is_going_now": best["is_going_now"],
            "total_seconds": total_sec,
            "days_left": days_left,
            "hours_left": hours_left,
            "minutes_left": mins_left,
            "seconds_left_mod": secs_left,
            "now_msk": now.strftime("%d.%m.%Y %H:%M:%S"),
        }


# Синглтон парсера
parser = ScheduleParser()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Тестирование парсера...")
    res = parser.get_data(force_refresh=True)
    print(f"Успешно спарсено: {res['groups_count']} групп")
    print(f"Преподавателей: {len(res['teachers'])}")
    print(f"Аудиторий: {len(res['classrooms'])}")
