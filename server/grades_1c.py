"""
Асинхронный модуль интеграции с веб-системой «1С:Образование 5. Школа» (Дневник).
Использует протокол GWT-RPC (Google Web Toolkit Remote Procedure Call)
для авторизации, получения списка дисциплин со средними баллами
и детальных отметок студента по темам занятий.
"""

import ast
import json
import logging
import re
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://online-obr-e5cloud-02-gpt-msk.1c.ru"
DEFAULT_DB_NAME = "moskva_kolledzh_telekommunikatcii_mtusi"

# GWT-RPC заголовки библиотеки (авторизация и списки пользователей)
LIB_HEADERS = {
    "x-gwt-permutation": "74C20090667D16D1D384233B3319FF99",
    "x-gwt-module-base": f"{BASE_URL}/ui/library/",
    "content-type": "text/x-gwt-rpc; charset=UTF-8",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "origin": BASE_URL,
    "referer": f"{BASE_URL}/library.html?db_name={DEFAULT_DB_NAME}"
}

# GWT-RPC заголовки дневника (журналы и оценки)
DIARY_HEADERS = {
    "x-gwt-permutation": "37633B262A09A1DEAF939903BF509BD9",
    "x-gwt-module-base": f"{BASE_URL}/ui/diary/",
    "content-type": "text/x-gwt-rpc; charset=UTF-8",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "origin": BASE_URL,
    "referer": f"{BASE_URL}/diary.html?db_name={DEFAULT_DB_NAME}"
}


KNOWN_GROUPS: Dict[str, int] = {
    "ИИ11-26АП": 9688, "ИИ11-26БП": 10610, "ИИ9-225АП": 9610, "ИИ9-225БП": 9611, "ИИ9-225ВП": 9612,
    "ИИ9-26АП": 9684, "ИИ9-26БП": 10613, "ИИ9-26ВП": 9674, "ИСП11-225П": 9613, "ИСП11-225Поз": 9614,
    "ИСП11-324П": 9633, "ИСП11-324оз": 9634, "ИСП11-423АПоз": 9650, "ИСП11-423ВПоз": 9651, "ИСП9-225": 9615,
    "ИСП9-225АП": 9616, "ИСП9-225БП": 9617, "ИСП9-225ВП": 9618, "ИСП9-324А": 9635, "ИСП9-324АП": 9636,
    "ИСП9-324Б": 9637, "ИСП9-324БП": 9638, "ИСП9-324ВП": 9639, "ИСП9-423А": 9653, "ИСП9-423Б": 9654,
    "ИСП9-423В": 9655, "ИСП9-423Г": 9656, "ИСП9-423П": 9657, "ИСС11-225зо": 9619, "ИСС11-324Пз": 9640,
    "ИСС11-423зо": 9658, "ИСС9-225": 9620, "ИСС9-26": 9680, "ИСС9-324": 9641, "ИСС9-423": 9659,
    "ОИБ11-225П": 9621, "ОИБ11-26": 9685, "ОИБ11-324П": 9642, "ОИБ9-225": 9622, "ОИБ9-225АП": 9623,
    "ОИБ9-225БП": 9624, "ОИБ9-26Б": 10612, "ОИБ9-324А": 9643, "ОИБ9-324Б": 9644, "ОИБ9-324П": 9645,
    "ОИБ9-423А": 9661, "ОИБ9-423Б": 9662, "ОИБ9-423В": 9663, "РЛ11-26П": 9686, "РЛ9-225П": 9625,
    "РУП11-26П": 9676, "РУП11-26Поз": 9671, "РУП9-26А": 9673, "РУП9-26АП": 9683, "РУП9-26Б": 9682,
    "РУП9-26БП": 9675, "СР9-225": 9626, "СР9-26": 9677, "СР9-324": 9646, "СР9-423": 9664,
    "ССА11-225П": 9627, "ССА11-26П": 9681, "ССА11-26Поз": 9672, "ССА11-423оз": 9666, "ССА9-225А": 9629,
    "ССА9-225Б": 9630, "ССА9-225П": 9631, "ССА9-26А": 9679, "ССА9-26Б": 9678, "ССА9-26П": 9687,
    "ССА9-324А": 9647, "ССА9-324Б": 9648, "ССА9-324П": 9649, "ССА9-423А": 9667, "ССА9-423Б": 9668,
    "ССА9-423В": 9669, "ЭБ11-26П": 10611, "ЭБ9-225П": 9632
}

_TRANSLIT_MAP = str.maketrans("ABEKMHOPCTXabekmhopctx", "АВЕКМНОРСТХавекмнорстх")

def resolve_group_info(group_input: Optional[str]) -> Tuple[str, int]:
    """Нормализует введенное название группы и возвращает (group_name, group_id)."""
    if not group_input:
        return "ИСС9-225", 9620

    clean = str(group_input).strip().translate(_TRANSLIT_MAP).upper()
    if clean in KNOWN_GROUPS:
        return clean, KNOWN_GROUPS[clean]

    compact = re.sub(r'[\s\-_]', '', clean)
    for g, gid in KNOWN_GROUPS.items():
        g_comp = re.sub(r'[\s\-_]', '', g).upper()
        if compact == g_comp:
            return g, gid

    # Поддержка коротких записей: ИСС9-25 -> ИСС9-225
    m = re.match(r'^([А-Я]+)(9|11)[-_]?(\d{2})([А-Яа-я]*)$', clean)
    if m:
        prefix, base, num, suffix = m.groups()
        for g, gid in KNOWN_GROUPS.items():
            if g.startswith(f"{prefix}{base}-") and g.endswith(num + suffix):
                return g, gid

    return "ИСС9-225", 9620


class OneCGradessClient:
    """Асинхронный клиент к веб-дневнику 1С:Образование 5."""

    def __init__(self, db_name: str = DEFAULT_DB_NAME, cookies: Optional[Dict[str, str]] = None):
        self.db_name = db_name
        self.client = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            cookies=cookies or {}
        )
        self.student_name: str = ""
        self.group_name: str = ""
        self.student_guid: str = ""

    async def close(self):
        await self.client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    def get_cookies_dict(self) -> Dict[str, str]:
        """Возвращает текущие cookies сессии для сохранения в зашифрованном виде."""
        return dict(self.client.cookies)

    async def init_session(self) -> bool:
        """Инициализация сессии через GET library.html."""
        try:
            url = f"{BASE_URL}/library.html?db_name={self.db_name}"
            resp = await self.client.get(url)
            return resp.status_code == 200
        except Exception as e:
            logger.warning(f"Ошибка init_session 1C: {e}")
            return False

    async def find_student_info(self, student_fio: str, group_id: int = 9620, group_name_hint: str = "ИСС9-225") -> Optional[Tuple[str, str, str]]:
        """
        Поиск GUID, ФИО и группы студента по строке поиска (фамилии или ФИО).
        Возвращает (guid, full_name, group_name) или None.
        """
        try:
            payload = (
                f"7|0|7|{BASE_URL}/ui/library/|2C134A3B24365D25989C6F84DBD9A209|"
                f"ru._1c.ui.common.client.CommonRemoteService|getGroupUserList|"
                f"java.lang.String/2004016611|I|{self.db_name}|1|2|3|4|2|5|6|7|{group_id}|"
            )
            resp = await self.client.post(f"{BASE_URL}/ui/common", headers=LIB_HEADERS, content=payload.encode("utf-8"))
            if resp.status_code != 200 or not resp.text.startswith("//OK"):
                return None

            data = ast.literal_eval(resp.text[4:].strip())
            str_table = [x for x in reversed(data) if isinstance(x, list) and len(x) > 10][0]

            lname_key = str_table.index("LName") + 1 if "LName" in str_table else -1
            guid_key = str_table.index("guid") + 1 if "guid" in str_table else -1
            fname_key = str_table.index("FName") + 1 if "FName" in str_table else -1
            sname_key = str_table.index("SName") + 1 if "SName" in str_table else -1

            search_term = student_fio.strip().lower()
            surname = search_term.split()[0] if search_term else ""

            if lname_key != -1 and guid_key != -1:
                for i, tok in enumerate(data):
                    if tok == lname_key:
                        lname_idx = data[i - 2]
                        if isinstance(lname_idx, int) and 1 <= lname_idx <= len(str_table):
                            found_sname = str_table[lname_idx - 1]
                            if surname in found_sname.lower():
                                guid = None
                                fname = ""
                                sname = ""
                                if i >= 8:
                                    g_idx = data[i - 8]
                                    if isinstance(g_idx, int) and 1 <= g_idx <= len(str_table):
                                        val = str_table[g_idx - 1]
                                        if re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", val):
                                            guid = val
                                if i >= 5:
                                    sn_idx = data[i - 5]
                                    if isinstance(sn_idx, int) and 1 <= sn_idx <= len(str_table):
                                        sname = str_table[sn_idx - 1]
                                if i >= 17:
                                    fn_idx = data[i - 17]
                                    if isinstance(fn_idx, int) and 1 <= fn_idx <= len(str_table):
                                        fname = str_table[fn_idx - 1]

                                if guid:
                                    full_name = f"{found_sname} {fname} {sname}".strip()
                                    return guid, full_name, group_name_hint
        except Exception as e:
            logger.warning(f"Ошибка find_student_info 1C: {e}")
        return None

    def _build_login_payload(self, login_guid: str, password: str) -> str:
        """Формирует тело GWT-RPC вызова createUserSession."""
        time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        strings = [
            f"{BASE_URL}/ui/library/",
            "2C134A3B24365D25989C6F84DBD9A209",
            "ru._1c.ui.common.client.CommonRemoteService",
            "createUserSession",
            "java.lang.String/2004016611",
            "ru._1c.ui.common.client.model.LoginRequestModel/2784278088",
            self.db_name,
            "com.extjs.gxt.ui.client.data.RpcMap/3441186752",
            "login",
            login_guid,
            "password",
            password,
            "localTime",
            time_str
        ]
        return f"7|0|{len(strings)}|{'|'.join(strings)}|1|2|3|4|2|5|6|7|6|0|8|3|9|5|10|11|5|12|13|5|14|"

    async def login(self, login_or_fio: str, password: str, group: str = "ИСС9-225") -> Tuple[bool, str]:
        """
        Авторизация в системе 1С.
        Принимает ФИО или GUID студента и пароль.
        Возвращает (успех, сообщение_об_ошибке).
        """
        await self.init_session()

        matched_group_name, group_id = resolve_group_info(group)
        guid = login_or_fio.strip()
        full_name = login_or_fio.strip()

        # Если передан не GUID, ищем по списку студентов
        if not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", guid):
            student_info = await self.find_student_info(login_or_fio, group_id=group_id, group_name_hint=matched_group_name)
            if student_info:
                guid, full_name, matched_group_name = student_info
            else:
                # Попробуем поискать по другим группам
                for other_gname, other_gid in KNOWN_GROUPS.items():
                    if other_gid != group_id:
                        fallback_info = await self.find_student_info(login_or_fio, group_id=other_gid, group_name_hint=other_gname)
                        if fallback_info:
                            guid, full_name, matched_group_name = fallback_info
                            break

                if not guid or not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", guid):
                    return False, f"Студент '{login_or_fio}' не найден в группе {matched_group_name}"

        self.student_guid = guid
        self.student_name = full_name
        self.group_name = matched_group_name

        payload = self._build_login_payload(guid, password)
        try:
            resp = await self.client.post(
                f"{BASE_URL}/ui/common",
                headers=LIB_HEADERS,
                content=payload.encode("utf-8")
            )
            if resp.status_code == 200 and resp.text.startswith("//OK"):
                return True, "Авторизация успешна"
            elif "//EX" in resp.text:
                return False, "Неверный пароль от дневника 1С"
            else:
                return False, f"Ошибка ответа сервера 1С: HTTP {resp.status_code}"
        except Exception as e:
            logger.error(f"Исключение при логине в 1C: {e}")
            return False, f"Сетевая ошибка при обращении к 1С: {str(e)}"

    async def get_all_grades(self) -> Dict[str, Any]:
        """
        Получает полный список предметов с их средними баллами
        и детальными оценками по урокам/заданиям.
        """
        try:
            # 1. Загрузка страницы дневника для настройки серверного контекста
            await self.client.get(f"{BASE_URL}/diary.html?db_name={self.db_name}")

            # 2. Запрос списка журналов студента
            j_payload = (
                f"7|0|5|{BASE_URL}/ui/diary/|7B00848B1B9D192D0E4E6566698D029C|"
                f"ru._1c.ui.diary.client.DiaryRemoteService|getStudentJournalList|I|"
                f"1|2|3|4|2|5|5|0|5014|"
            )
            resp = await self.client.post(
                f"{BASE_URL}/ui/diary",
                headers=DIARY_HEADERS,
                content=j_payload.encode("utf-8")
            )
            if resp.status_code != 200 or not resp.text.startswith("//OK"):
                return {"error": "Не удалось загрузить список журналов 1С", "subjects": []}

            data = ast.literal_eval(resp.text[4:].strip())
            str_table = [x for x in reversed(data) if isinstance(x, list) and len(x) > 10][0]

            # Извлечение всех предметов в порядке их появления в токенах
            subj_key = str_table.index("subjectName") + 1
            avg_key = str_table.index("averageMark") + 1

            entries = []
            for i, tok in enumerate(data):
                if tok == subj_key:
                    s_idx = data[i - 2]
                    subj = str_table[s_idx - 1] if 1 <= s_idx <= len(str_table) else "Предмет"

                    # Средний балл
                    avg_val = None
                    raw_avg = ""
                    for k in range(i, min(len(data), i + 10)):
                        if data[k] == avg_key:
                            if data[k - 1] == 12:  # String
                                avg_tok = data[k - 2]
                                if isinstance(avg_tok, int) and 1 <= avg_tok <= len(str_table):
                                    raw_avg = str_table[avg_tok - 1]
                                    try:
                                        avg_val = float(raw_avg.replace(",", "."))
                                    except ValueError:
                                        pass
                            break

                    entries.append({"subject": subj, "average_mark": avg_val, "raw_average": raw_avg})

            # Все ID журналов в порядке следования
            jids = [x for x in data if isinstance(x, int) and 31000 <= x <= 35000]

            subjects = []
            for jid, entry in zip(jids, entries):
                subjects.append({
                    "journal_id": jid,
                    "subject": entry["subject"],
                    "average_mark": entry["average_mark"],
                    "raw_average": entry["raw_average"],
                    "grades": []
                })

            # 3. Запрос отметок по каждому предмету
            all_recent_grades = []
            for s in subjects:
                jid = s["journal_id"]
                t_payload = (
                    f"7|0|5|{BASE_URL}/ui/diary/|7B00848B1B9D192D0E4E6566698D029C|"
                    f"ru._1c.ui.diary.client.DiaryRemoteService|getJournalNormalTasks|I|"
                    f"1|2|3|4|1|5|{jid}|"
                )
                try:
                    t_resp = await self.client.post(
                        f"{BASE_URL}/ui/diary",
                        headers=DIARY_HEADERS,
                        content=t_payload.encode("utf-8")
                    )
                    if t_resp.status_code == 200 and t_resp.text.startswith("//OK"):
                        t_data = ast.literal_eval(t_resp.text[4:].strip())
                        str_tables = [x for x in reversed(t_data) if isinstance(x, list) and len(x) > 0]
                        t_str_table = str_tables[0] if str_tables else []
                        if len(t_str_table) <= 1:
                            continue

                        # Поиск дат и отметок
                        for i in range(len(t_data) - 5):
                            val = t_data[i]
                            if isinstance(val, int) and 2020 <= val <= 2030:
                                month = t_data[i + 1]
                                day = t_data[i + 2]
                                if isinstance(month, int) and 1 <= month <= 12 and isinstance(day, int) and 1 <= day <= 31:
                                    date_str = f"{day:02d}.{month:02d}.{val}"
                                    window = t_data[max(0, i - 30): min(len(t_data), i + 25)]

                                    grade = None
                                    if 1000 in window:
                                        grade = 5
                                    elif 850 in window:
                                        grade = 4
                                    elif 700 in window:
                                        grade = 3
                                    elif 500 in window:
                                        grade = 2

                                    topic = ""
                                    for token in window:
                                        if isinstance(token, int) and 1 <= token <= len(t_str_table):
                                            txt = t_str_table[token - 1]
                                            if (len(txt) > 3 and not txt.startswith("ru._1c") and
                                                    not txt.startswith("com.") and not txt.startswith("java.") and
                                                    txt not in ["theme", "ordernum"]):
                                                topic = txt

                                    if grade is not None:
                                        grade_item = {
                                            "date": date_str,
                                            "grade": grade,
                                            "topic": topic
                                        }
                                        s["grades"].append(grade_item)
                                        all_recent_grades.append({
                                            "date": date_str,
                                            "subject": s["subject"],
                                            "grade": grade,
                                            "topic": topic
                                        })
                except Exception as ex:
                    logger.warning(f"Ошибка получения отметок для предмета {s['subject']} ({jid}): {ex}")
                    continue

            # Сортировка оценок по дате убывания
            def parse_d(item):
                try:
                    return datetime.strptime(item["date"], "%d.%m.%Y")
                except Exception:
                    return datetime.min

            for s in subjects:
                s["grades"].sort(key=parse_d, reverse=True)

            all_recent_grades.sort(key=parse_d, reverse=True)

            # Общий средний балл
            valid_avgs = [s["average_mark"] for s in subjects if s["average_mark"] is not None]
            overall_avg = round(sum(valid_avgs) / len(valid_avgs), 2) if valid_avgs else None

            return {
                "student": self.student_name or "Студент",
                "group": self.group_name or "ИСС9-225",
                "overall_average": overall_avg,
                "subjects_count": len(subjects),
                "subjects_with_grades": len(valid_avgs),
                "subjects": subjects,
                "recent_grades": all_recent_grades,
                "synced_at": datetime.now().strftime("%d.%m.%Y %H:%M")
            }

        except Exception as e:
            logger.error(f"Критическая ошибка get_all_grades: {e}")
            return {"error": str(e), "subjects": []}


async def fetch_grades_with_credentials(login_or_fio: str, password: str, group: str = "ИСС9-225") -> Dict[str, Any]:
    """Вспомогательная функция быстрого получения оценок по логину и паролю."""
    async with OneCGradessClient() as client:
        ok, msg = await client.login(login_or_fio, password, group)
        if not ok:
            return {"error": msg}
        data = await client.get_all_grades()
        data["cookies"] = client.get_cookies_dict()
        return data
