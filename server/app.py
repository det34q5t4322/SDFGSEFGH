import os
import sys
import time
import asyncio
import logging
import urllib.request
from collections import defaultdict
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from parser import parser, _circuit_breaker, is_test_tab, get_full_teacher_name, get_moscow_now

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="College Schedule API",
    description="API расписания занятий Колледжа телекоммуникаций",
    version="1.0.0",
)

# Разрешаем CORS для работы WebApp и сторонних клиентов
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "static")

# Скользящее окно для ограничения частоты запросов (защита бесплатного инстанса Render)
RATE_LIMIT_WINDOW = 60  # сек
MAX_REQUESTS_PER_WINDOW = 120  # запросов в минуту с одного IP

_ip_request_timestamps = defaultdict(list)

@app.middleware("http")
async def rate_limiting_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/ping"):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        timestamps = _ip_request_timestamps[client_ip]
        # Очищаем устаревшие метки
        _ip_request_timestamps[client_ip] = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
        if len(_ip_request_timestamps[client_ip]) >= MAX_REQUESTS_PER_WINDOW:
            logger.warning(f"Превышен лимит запросов с IP: {client_ip} на {request.url.path}")
            return JSONResponse(
                status_code=429,
                content={"detail": "Слишком много запросов. Пожалуйста, подождите минуту."},
                headers={"Retry-After": "60"},
            )
        _ip_request_timestamps[client_ip].append(now)
    return await call_next(request)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


async def _sync_once():
    """Одна попытка синхронизации с Google Sheets."""
    data = parser.get_data(force_refresh=True)
    stale = data.get("stale", False)
    if stale:
        logger.warning(f"Авто-синхронизация: данные устаревшие ({data.get('stale_reason', '')})")
    else:
        logger.info(f"Авто-синхронизация OK: {data['last_updated']} | групп: {data.get('groups_count', '?')}")


async def background_sync_task():
    """Самовосстанавливающийся фоновый синхронизатор (каждые 30 сек).
    При любой ошибке не умирает — перезапускается через 60 секунд.
    """
    logger.info("Запущен фоновый синхронизатор (каждые 30 сек, самовосстанавливающийся)")
    consecutive_errors = 0
    while True:
        try:
            await asyncio.sleep(30)
            await _sync_once()
            consecutive_errors = 0
        except asyncio.CancelledError:
            logger.info("Фоновый синхронизатор остановлен")
            return
        except Exception as e:
            consecutive_errors += 1
            wait = min(60 * consecutive_errors, 300)  # до 5 минут
            logger.error(
                f"Ошибка синхронизации #{consecutive_errors}: {e} "
                f"— перезапуск через {wait}с"
            )
            try:
                await asyncio.sleep(wait)
            except asyncio.CancelledError:
                return


async def render_keep_alive_task():
    """Фоновый пингер для предотвращения засыпания бесплатного сервиса Render (каждые 12 минут)."""
    await asyncio.sleep(60)
    render_url = os.getenv("RENDER_EXTERNAL_URL", "https://sdfgsefgh.onrender.com")
    ping_url = f"{render_url.rstrip('/')}/api/ping"
    logger.info(f"Запущен keep-alive пингер: {ping_url} (каждые 12 мин)")
    while True:
        try:
            loop = asyncio.get_event_loop()
            req = urllib.request.Request(ping_url, headers={"User-Agent": "Render-KeepAlive/1.0"})
            await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=15).read())
            logger.debug(f"Keep-alive пинг успешен: {ping_url}")
        except Exception as e:
            logger.debug(f"Keep-alive пинг (локально или при холодном старте): {e}")
        await asyncio.sleep(12 * 60)


@app.on_event("startup")
async def startup_event():
    """При старте загружаем или проверяем кэш расписания."""
    try:
        data = parser.get_data(force_refresh=True)
        logger.info(f"Расписание инициализировано: {data['groups_count']} групп")
    except Exception as e:
        logger.error(f"Ошибка инициализации расписания: {e}")
    # Запускаем постоянный фоновый опрос Google таблицы
    asyncio.create_task(background_sync_task())
    # Запускаем keep-alive пингер для Render
    asyncio.create_task(render_keep_alive_task())


@app.get("/api/health")
@app.get("/api/ping")
async def health_check():
    """Проверка жизнеспособности сервера, кэша и времени МСК."""
    now_msk = get_moscow_now()
    active_data = parser.data
    cache_age = round(time.time() - parser.last_updated, 1) if parser.last_updated else None
    return {
        "status": "ok",
        "time_msk": now_msk.strftime("%d.%m.%Y %H:%M:%S"),
        "groups_count": active_data.get("groups_count", 0) if active_data else 0,
        "active_gid": parser.active_gid,
        "circuit_breaker": _circuit_breaker.status_dict(),
        "cache_age_seconds": cache_age,
    }


@app.get("/")
async def root():
    """Отдача главного интерфейса расписания."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    return {"message": "Schedule Web Service is running. Open /static/index.html"}


@app.get("/api/tabs")
async def get_tabs():
    """Список всех обнаруженных вкладок расписания в Google Таблице с отметкой активной."""
    tabs_data = parser.get_tabs()
    clean_tabs = [t for t in tabs_data.get("tabs", []) if not is_test_tab(t.get("name"))]
    return {
        "tabs": clean_tabs,
        "active_gid": tabs_data.get("active_gid", ""),
    }


@app.get("/api/status")
async def get_status(
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Текущий статус сервиса, дата обновления, чётность недели, звонки и перемены."""
    selected_tab = tab or gid
    data = parser.get_data(gid=selected_tab)
    clean_tabs = [t for t in data.get("available_tabs", []) if not is_test_tab(t.get("name"))]
    return {
        "title": data.get("title", "Колледж телекоммуникаций"),
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
        "is_active_tab": data.get("is_active_tab", True),
        "available_tabs": clean_tabs,
        "active_gid": data.get("active_gid", ""),
        "subtitle": data.get("subtitle", ""),
        "last_updated": data.get("last_updated", ""),
        "timestamp": data.get("timestamp", 0),
        "groups_count": data.get("groups_count", 0),
        "teachers_count": len(data.get("teachers", [])),
        "classrooms_count": len(data.get("classrooms", [])),
        "bell_times": data.get("bell_times", {}),
        "break_times": data.get("break_times", []),
        "week_info": data.get("week_info", {}),
        "day_dates": data.get("day_dates", {}),
    }


@app.get("/api/groups")
async def get_groups(
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Список всех учебных групп с распределением по курсам."""
    selected_tab = tab or gid
    data = parser.get_data(gid=selected_tab)
    return {
        "groups": data.get("groups", []),
        "courses": ["1 курс", "2 курс", "3 курс", "4 курс", "Очно-заочное"],
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
    }


@app.get("/api/schedule")
async def get_schedule(
    group: Optional[str] = Query(None, description="Название группы, например ИСП9-24А"),
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)"),
    date: Optional[str] = Query(None, description="Календарная дата для авто-выбора вкладки (YYYY-MM-DD)")
):
    """Полное расписание для конкретной учебной группы или метаданные со списком групп с авто-сопоставлением вкладки по дате."""
    selected_tab = tab or gid
    if not selected_tab and date:
        matched_tab = parser.find_tab_for_date(date)
        if not matched_tab:
            tabs_data = parser.get_tabs()
            clean_tabs = [t for t in tabs_data.get("tabs", []) if not is_test_tab(t.get("name"))]
            return {
                "published": False,
                "message": "Расписание на эту неделю ещё не опубликовано",
                "target_date": date,
                "group": group or "",
                "available_tabs": clean_tabs,
                "active_gid": tabs_data.get("active_gid", ""),
            }
        selected_tab = matched_tab["gid"]

    data = parser.get_data(gid=selected_tab)
    clean_tabs = [t for t in data.get("available_tabs", []) if not is_test_tab(t.get("name"))]

    if not group:
        return {
            "published": True,
            "groups": data.get("groups", []),
            "courses": ["1 курс", "2 курс", "3 курс", "4 курс", "Очно-заочное"],
            "tab_name": data.get("tab_name", ""),
            "gid": data.get("gid", ""),
            "available_tabs": clean_tabs,
            "active_gid": data.get("active_gid", ""),
            "bell_times": data.get("bell_times", {}),
            "break_times": data.get("break_times", []),
            "week_info": data.get("week_info", {}),
            "day_dates": data.get("day_dates", {}),
            "last_updated": data.get("last_updated", ""),
            "timestamp": data.get("timestamp", 0),
        }

    group_norm = group.strip()
    schedules = data.get("schedules", {})

    if group_norm not in schedules:
        # Попробуем регистронезависимый поиск
        found = None
        for g_name in schedules:
            if g_name.lower() == group_norm.lower():
                found = g_name
                break
        if found:
            group_norm = found
        else:
            raise HTTPException(status_code=404, detail=f"Группа '{group}' не найдена")

    return {
        "published": True,
        "group": group_norm,
        "course": schedules[group_norm].get("course", ""),
        "section": schedules[group_norm].get("section", ""),
        "days": schedules[group_norm].get("days", {}),
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
        "available_tabs": clean_tabs,
        "active_gid": data.get("active_gid", ""),
        "bell_times": data.get("bell_times", {}),
        "break_times": data.get("break_times", []),
        "week_info": data.get("week_info", {}),
        "day_dates": data.get("day_dates", {}),
        "last_updated": data.get("last_updated", ""),
        "timestamp": data.get("timestamp", 0),
    }


class UserGroupPayload(BaseModel):
    user_id: str
    group: str


@app.get("/api/user-group")
async def get_api_user_group(user_id: Optional[str] = Query(None)):
    """Получить сохранённую группу пользователя Telegram."""
    if not user_id:
        return {"group": "ИСС9-25"}
    try:
        from bot import get_user_group
        grp = get_user_group(int(user_id))
        return {"group": grp}
    except Exception as e:
        logger.warning(f"Error getting user group for {user_id}: {e}")
        return {"group": "ИСС9-25"}


@app.post("/api/user-group")
async def set_api_user_group(payload: UserGroupPayload):
    """Сохранить выбранную группу пользователя Telegram."""
    try:
        from bot import set_user_group
        set_user_group(int(payload.user_id), "", payload.group)
        return {"status": "success", "group": payload.group}
    except Exception as e:
        logger.warning(f"Error setting user group for {payload.user_id}: {e}")
        return {"status": "error", "message": str(e), "group": payload.group}


@app.get("/api/english-alarm")
async def get_english_alarm(
    group: Optional[str] = Query(None, description="Название группы")
):
    """Информация о ближайшем занятии по английскому языку / тревоге и обратный отсчет."""
    target_group = (group or "ИСС9-25").strip()
    return parser.get_upcoming_alarm(target_group, pattern=r"(англ|иностр)")


@app.get("/api/teachers")
async def get_teachers(
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Список всех преподавателей."""
    selected_tab = tab or gid
    data = parser.get_data(gid=selected_tab)
    return {
        "teachers": data.get("teachers", []),
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
    }


@app.get("/api/teacher-schedule")
async def get_teacher_schedule(
    teacher: str = Query(..., description="ФИО преподавателя"),
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Расписание занятий для конкретного преподавателя."""
    selected_tab = tab or gid
    data = parser.get_data(gid=selected_tab)
    teacher_norm = teacher.strip()
    teacher_schedules = data.get("teacher_schedules", {})

    if teacher_norm not in teacher_schedules:
        full_mapped = get_full_teacher_name(teacher_norm)
        if full_mapped in teacher_schedules:
            teacher_norm = full_mapped
        else:
            matches = [t for t in teacher_schedules if teacher_norm.lower() in t.lower() or t.lower() in teacher_norm.lower()]
            if len(matches) >= 1:
                teacher_norm = matches[0]
            elif not matches:
                raise HTTPException(status_code=404, detail=f"Преподаватель '{teacher}' не найден")

    lessons = teacher_schedules.get(teacher_norm, [])
    grouped_by_day = {}
    for item in lessons:
        d = item["day"]
        grouped_by_day.setdefault(d, []).append(item)

    for d in grouped_by_day:
        grouped_by_day[d].sort(key=lambda x: x["pair_num"])

    return {
        "teacher": teacher_norm,
        "days": grouped_by_day,
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
        "last_updated": data.get("last_updated", ""),
    }


@app.get("/api/classrooms")
async def get_classrooms(
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Список всех кабинетов и аудиторий."""
    selected_tab = tab or gid
    data = parser.get_data(gid=selected_tab)
    return {
        "classrooms": data.get("classrooms", []),
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
    }


@app.get("/api/classroom-schedule")
async def get_classroom_schedule(
    room: str = Query(..., description="Номер или название аудитории"),
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Занятость конкретной аудитории по дням недели."""
    selected_tab = tab or gid
    data = parser.get_data(gid=selected_tab)
    room_norm = room.strip()
    classroom_schedules = data.get("classroom_schedules", {})

    if room_norm not in classroom_schedules:
        matches = [r for r in classroom_schedules if room_norm.lower() == r.lower()]
        if matches:
            room_norm = matches[0]
        else:
            raise HTTPException(status_code=404, detail=f"Аудитория '{room}' не найдена")

    lessons = classroom_schedules.get(room_norm, [])
    grouped_by_day = {}
    for item in lessons:
        d = item["day"]
        grouped_by_day.setdefault(d, []).append(item)

    for d in grouped_by_day:
        grouped_by_day[d].sort(key=lambda x: x["pair_num"])

    return {
        "classroom": room_norm,
        "days": grouped_by_day,
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
        "last_updated": data.get("last_updated", ""),
    }


@app.get("/api/health")
async def health_check():
    """Полная диагностика сервиса: вкладки, circuit breaker, свежесть данных."""
    import time as _time
    warnings = []
    try:
        tabs_info = parser.get_tabs()
        tabs = tabs_info.get("tabs", [])
        active_gid = tabs_info.get("active_gid", "")

        data = parser.get_data()
        last_updated = data.get("last_updated", "")
        timestamp = data.get("timestamp", 0)
        groups_count = data.get("groups_count", 0)
        tab_name = data.get("tab_name", "")
        is_stale = data.get("stale", False)
        stale_reason = data.get("stale_reason", "")

        # Circuit breaker
        cb = _circuit_breaker.status_dict()
        if cb["state"] == "OPEN":
            warnings.append(f"CircuitBreaker OPEN: Google Sheets временно недоступен (ошибок: {cb['failures']}, с {cb['open_since']})")
        elif cb["state"] == "HALF_OPEN":
            warnings.append("CircuitBreaker HALF_OPEN: проверяем восстановление Google Sheets")

        # Устаревшие данные
        if is_stale:
            warnings.append(f"Данные устаревшие: {stale_reason}")
        elif timestamp and (_time.time() - timestamp) > 300:
            age_min = int((_time.time() - timestamp) / 60)
            warnings.append(f"Данные не обновлялись {age_min} мин — возможна проблема с Google Sheets")

        if len(tabs) <= 1:
            warnings.append(
                f"Найдена только {len(tabs)} вкладка — возможна проблема с обнаружением. "
                "Ожидается минимум 2 вкладки (неделя + Основное)."
            )
        if groups_count == 0:
            warnings.append("Групп не найдено — расписание пустое или не спарсилось.")

        age_sec = int(_time.time() - timestamp) if timestamp else None

        return {
            "status": "ok" if not warnings else "warning",
            "warnings": warnings,
            "active_tab": tab_name,
            "active_gid": active_gid,
            "tabs_found": len(tabs),
            "tabs": [{"name": t["name"], "gid": t["gid"], "is_active": t["is_active"]} for t in tabs],
            "groups_count": groups_count,
            "last_updated": last_updated,
            "data_age_seconds": age_sec,
            "stale": is_stale,
            "circuit_breaker": cb,
            "uptime_check": "PASS" if not warnings else "WARN",
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "error": str(e),
                "warnings": [f"Критическая ошибка сервиса: {e}"],
                "circuit_breaker": _circuit_breaker.status_dict(),
                "uptime_check": "FAIL",
            },
        )


@app.post("/api/refresh")
async def refresh_schedule(tab: Optional[str] = Query(None, description="GID или название вкладки")):
    """Принудительное обновление расписания из Google Sheets."""
    try:
        parser.refresh_tabs(force=True)
        updated = parser.get_data(gid=tab, force_refresh=True)
        return {
            "status": "success",
            "message": f"Расписание вкладки '{updated.get('tab_name', '')}' успешно обновлено",
            "tab_name": updated.get("tab_name", ""),
            "gid": updated.get("gid", ""),
            "available_tabs": updated.get("available_tabs", []),
            "last_updated": updated["last_updated"],
            "groups_count": updated["groups_count"],
        }
    except Exception as e:
        logger.error(f"Ошибка при обновлении расписания: {e}")
        raise HTTPException(status_code=500, detail=f"Не удалось обновить: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
