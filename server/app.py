import os
import sys
import time
import asyncio
import logging
import re
import urllib.request
from collections import defaultdict
from typing import Optional, List, Dict
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from parser import parser, _circuit_breaker, is_test_tab, get_full_teacher_name, get_moscow_now
from security import verify_telegram_init_data, is_admin_user
import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

_bot_app = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bot_app
    if os.getenv("RUN_BOT_IN_APP", "false").lower() == "true":
        try:
            from bot import create_bot_app
            _bot_app = create_bot_app()
            if _bot_app:
                await _bot_app.initialize()
                await _bot_app.start()
                await _bot_app.updater.start_polling()
                logger.info("Telegram-бот успешно запущен в приложении FastAPI!")
        except Exception as e:
            logger.warning(f"Не удалось запустить Telegram-бот в фоне: {e}")

    yield

    if _bot_app:
        try:
            logger.info("Остановка Telegram-бота...")
            await _bot_app.updater.stop()
            await _bot_app.stop()
            await _bot_app.shutdown()
            logger.info("Telegram-бот остановлен.")
        except Exception as e:
            logger.warning(f"Ошибка при остановке бота: {e}")

app = FastAPI(
    title="College Schedule API",
    description="API расписания занятий Колледжа телекоммуникаций",
    version="1.0.0",
    lifespan=lifespan,
)

# Gzip-сжатие ответов (сжимает JS, CSS, JSON расписания до 70-80% меньше размера)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Разрешаем CORS для работы WebApp и сторонних клиентов
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "static")

# Скользящее окно для ограничения частоты запросов (защита бесплатного инстанса Render)
RATE_LIMIT_WINDOW = 60  # сек
MAX_REQUESTS_PER_WINDOW = 120  # запросов в минуту с одного IP

_ip_request_timestamps = defaultdict(list)

# Онлайн-трекинг активных пользователей (TTL 5 минут)
ONLINE_TTL = 300  # секунд
_online_users: dict = {}  # {telegram_id: {"username": str, "first_name": str, "last_seen": float}}

def get_real_client_ip(request: Request) -> str:
    """Извлечение реального IP клиента с учетом заголовков обратных прокси (Cloudflare, Render, Nginx)."""
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    x_forwarded = request.headers.get("x-forwarded-for")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    x_real = request.headers.get("x-real-ip")
    if x_real:
        return x_real.strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limiting_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/ping"):
        client_ip = get_real_client_ip(request)
        now = time.time()
        timestamps = _ip_request_timestamps[client_ip]
        # Очищаем устаревшие метки
        valid = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
        if len(valid) >= MAX_REQUESTS_PER_WINDOW:
            _ip_request_timestamps[client_ip] = valid
            logger.warning(f"Превышен лимит запросов с IP: {client_ip} на {request.url.path}")
            return JSONResponse(
                status_code=429,
                content={"detail": "Слишком много запросов. Пожалуйста, подождите минуту."},
                headers={"Retry-After": "60"},
            )
        valid.append(now)
        _ip_request_timestamps[client_ip] = valid
        if len(_ip_request_timestamps) > 500:
            for ip in list(_ip_request_timestamps.keys()):
                if not _ip_request_timestamps[ip] or now - _ip_request_timestamps[ip][-1] > RATE_LIMIT_WINDOW:
                    _ip_request_timestamps.pop(ip, None)
    return await call_next(request)

PUBLIC_ROUTES = {"/api/ping", "/api/health", "/api/english-alarm", "/api/activity", "/api/report-bug"}

def get_verified_user_from_request(request: Request) -> Optional[dict]:
    """Извлекает и валидирует Telegram WebApp initData с кэшированием сессии в request.state."""
    if hasattr(request.state, "verified_user"):
        return request.state.verified_user

    client_ip = get_real_client_ip(request)
    # Поддержка dev-режима на локалхосте
    if client_ip in ("127.0.0.1", "localhost", "::1", "testclient"):
        if request.query_params.get("dev") == "1" or request.headers.get("x-dev-mode") == "1":
            user = {"id": 7552844207, "username": "Dadrik1", "first_name": "AdminDev", "is_admin": True, "is_banned": False}
            request.state.verified_user = user
            return user
        mock_uid = request.query_params.get("mock_user") or request.headers.get("x-mock-user")
        if mock_uid and mock_uid.isdigit():
            uid = int(mock_uid)
            user = {
                "id": uid,
                "username": f"user_{uid}",
                "first_name": "Test",
                "is_admin": is_admin_user(uid),
                "is_banned": db.is_user_banned(uid)
            }
            request.state.verified_user = user
            return user

    init_data = (
        request.headers.get("x-telegram-init-data")
        or request.query_params.get("init_data")
        or ""
    )
    bot_token = os.getenv("BOT_TOKEN", "")
    if not init_data or not bot_token:
        request.state.verified_user = None
        return None

    user = verify_telegram_init_data(init_data, bot_token)
    request.state.verified_user = user
    return user


@app.middleware("http")
async def telegram_gate_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_ROUTES:
        user = get_verified_user_from_request(request)

        # Онлайн-трекинг: записываем активность аутентифицированного пользователя
        if user and not user.get("is_banned"):
            try:
                uid = user.get("id") or user.get("telegram_id")
                if uid:
                    uid = int(uid)
                    db.record_hourly_request(uid)
                    prev = _online_users.get(uid, {})
                    _online_users[uid] = {
                        "username": user.get("username", "") or prev.get("username", ""),
                        "first_name": user.get("first_name", "") or prev.get("first_name", ""),
                        "last_seen": time.time(),
                        "connected_at": prev.get("connected_at", time.time()),
                        "ip": get_real_client_ip(request),
                        "group": prev.get("group", ""),
                        "last_action": prev.get("last_action", "Просмотр расписания"),
                        "platform": prev.get("platform", "WebApp")
                    }
            except Exception:
                pass

        # Скрытие админ-панели (Zero-Knowledge): для любого не-владельца админки НЕ СУЩЕСТВУЕТ
        if path.startswith("/api/admin"):
            if not user or not user.get("is_admin") or user.get("is_banned"):
                return JSONResponse(status_code=404, content={"detail": "Not Found"})

        if user and user.get("is_banned"):
            # ПОЛЬЗОВАТЕЛЬ ЗАБАНЕН: клиент переводится в бесконечную загрузку (кружок)
            if path == "/api/schedule":
                return JSONResponse({
                    "published": False,
                    "gate_active": True,
                    "is_banned": True,
                    "group": "",
                    "groups": [],
                    "courses": [],
                    "available_tabs": [],
                    "days": {}
                })
            elif path == "/api/auth-status":
                return JSONResponse({"authenticated": False, "is_admin": False, "is_banned": True})
            elif path == "/api/tabs":
                return JSONResponse({"tabs": [], "active_gid": "", "is_banned": True})
            elif path == "/api/groups":
                return JSONResponse({"groups": [], "courses": [], "is_banned": True})
            else:
                return JSONResponse({"gate_active": True, "published": False, "is_banned": True})

        if not user:
            # Если запрос пришел вне Telegram или подпись невалидна:
            # Не отдаем данные, не раскрывая статусных кодов (200 OK с пустой структурой, удержание в вечном скелетоне)
            if path == "/api/schedule":
                return JSONResponse({
                    "published": False,
                    "gate_active": True,
                    "group": "",
                    "groups": [],
                    "courses": [],
                    "available_tabs": [],
                    "days": {}
                })
            elif path == "/api/tabs":
                return JSONResponse({"tabs": [], "active_gid": ""})
            elif path == "/api/groups":
                return JSONResponse({"groups": [], "courses": []})
            elif path == "/api/auth-status":
                return JSONResponse({"authenticated": False, "is_admin": False})
            else:
                return JSONResponse({"gate_active": True, "published": False})

    return await call_next(request)

@app.middleware("http")
async def add_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/fonts/"):
        # Шрифты неизменны — кэшируем в браузере на 7 дней
        response.headers["Cache-Control"] = "public, max-age=604800, immutable"
    elif path.startswith("/static/"):
        # Статика (CSS, JS, иконки): разрешаем кэш с валидацией ETag и фоновым обновлением
        response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=86400"
    elif path == "/":
        # Главная HTML-страница — всегда проверяем актуальность, но разрешаем 304 Not Modified
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


async def _sync_once():
    """Одна попытка синхронизации с Google Sheets."""
    data = await asyncio.to_thread(parser.get_data, force_refresh=True)
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
        data = await asyncio.to_thread(parser.get_data, force_refresh=True)
        logger.info(f"Расписание инициализировано: {data['groups_count']} групп")
    except Exception as e:
        logger.error(f"Ошибка инициализации расписания: {e}")
    # Запускаем постоянный фоновый опрос Google таблицы
    asyncio.create_task(background_sync_task())
    # Запускаем keep-alive пингер для Render
    asyncio.create_task(render_keep_alive_task())


def _clean_tabs(tabs: list) -> list:
    """Фильтрация служебных и тестовых вкладок."""
    return [t for t in tabs if not is_test_tab(t.get("name"))]


def _group_lessons_by_day(lessons: list) -> dict:
    """Группировка списка пар по дням недели с сортировкой по номеру пары."""
    grouped = {}
    for item in lessons:
        grouped.setdefault(item["day"], []).append(item)
    for d in grouped:
        grouped[d].sort(key=lambda x: x.get("pair_num", 0))
    return grouped


@app.get("/api/ping")
async def ping():
    """Легковесный ping для keep-alive пингера и быстрой проверки доступности."""
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


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return JSONResponse(status_code=204, content=None)


@app.get("/sw.js", include_in_schema=False)
@app.get("/service-worker.js", include_in_schema=False)
async def unregister_sw():
    content = "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister().then(()=>caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))))));"
    return Response(content=content, media_type="application/javascript", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


@app.get("/")
async def root(request: Request):
    """Отдача главного интерфейса расписания."""
    user = get_verified_user_from_request(request)
    if user and user.get("is_banned"):
        return HTMLResponse(
            content="""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Расписание | Колледж телекоммуникаций</title>
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; height:100dvh; background:#0b0c16; overflow:hidden; display:flex; align-items:center; justify-content:center; user-select:none; -webkit-user-select:none; }
  .spinner { width:44px; height:44px; border:3.5px solid rgba(255,255,255,0.12); border-top-color:#4f8ef7; border-right-color:#4f8ef7; border-radius:50%; animation:spin 0.75s linear infinite; }
  @keyframes spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }
</style>
</head>
<body>
  <div class="spinner"></div>
</body>
</html>""",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={
                "Cache-Control": "no-cache, must-revalidate",
            },
        )
    return {"message": "Schedule Web Service is running. Open /static/index.html"}


@app.get("/api/tabs")
async def get_tabs():
    """Список всех обнаруженных вкладок расписания в Google Таблице с отметкой активной."""
    tabs_data = await asyncio.to_thread(parser.get_tabs)
    return {
        "tabs": _clean_tabs(tabs_data.get("tabs", [])),
        "active_gid": tabs_data.get("active_gid", ""),
    }


@app.get("/api/status")
async def get_status(
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Текущий статус сервиса, дата обновления, чётность недели, звонки и перемены."""
    selected_tab = tab or gid
    data = await asyncio.to_thread(parser.get_data, gid=selected_tab)
    return {
        "title": data.get("title", "Колледж телекоммуникаций"),
        "tab_name": data.get("tab_name", ""),
        "gid": data.get("gid", ""),
        "is_active_tab": data.get("is_active_tab", True),
        "available_tabs": _clean_tabs(data.get("available_tabs", [])),
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
    data = await asyncio.to_thread(parser.get_data, gid=selected_tab)
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
        matched_tab = await asyncio.to_thread(parser.find_tab_for_date, date)
        if not matched_tab:
            tabs_data = await asyncio.to_thread(parser.get_tabs)
            return {
                "published": False,
                "message": "Расписание на эту неделю ещё не опубликовано",
                "target_date": date,
                "group": group or "",
                "available_tabs": _clean_tabs(tabs_data.get("tabs", [])),
                "active_gid": tabs_data.get("active_gid", ""),
            }
        selected_tab = matched_tab["gid"]

    data = await asyncio.to_thread(parser.get_data, gid=selected_tab)
    clean_tabs = _clean_tabs(data.get("available_tabs", []))

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
        # 1. Точное совпадение без учета регистра
        matched = next((g for g in schedules if g.lower() == group_norm.lower()), None)
        if matched:
            group_norm = matched
        else:
            # 2. Очистка от пробелов и дефисов
            clean_input = re.sub(r'[\s\-]+', '', group_norm).lower()
            matched = next((g for g in schedules if re.sub(r'[\s\-]+', '', g).lower() == clean_input), None)
            if matched:
                group_norm = matched
            else:
                # 3. Отрезание суффиксов подгрупп (например, "ИСС9-25П", "ИСС9-25 (1)", "ИСС9-25-1")
                candidates = [
                    re.sub(r'[пП]$', '', group_norm).strip(),
                    re.sub(r'[\(\s\-]+[12]п?[\)\s]*$', '', group_norm, flags=re.I).strip(),
                    re.sub(r'[\s\-]+', '', re.sub(r'[пП]$', '', group_norm)).strip()
                ]
                for cand in candidates:
                    if cand and cand != group_norm:
                        matched = next((g for g in schedules if g.lower() == cand.lower()), None)
                        if not matched:
                            clean_cand = re.sub(r'[\s\-]+', '', cand).lower()
                            matched = next((g for g in schedules if re.sub(r'[\s\-]+', '', g).lower() == clean_cand), None)
                        if matched:
                            group_norm = matched
                            break

        if group_norm not in schedules:
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
    user_id: int = Field(..., gt=0, description="Telegram User ID (положительное целое число)")
    group: str = Field(..., min_length=1, max_length=50, description="Код/название группы")
    init_data: Optional[str] = Field(None, description="Telegram WebApp initData для проверки HMAC подписи")


@app.get("/api/user-group")
async def get_api_user_group(user_id: Optional[str] = Query(None)):
    """Получить сохранённую группу пользователя Telegram."""
    if not user_id:
        return {"group": "ИСС9-25"}
    try:
        uid = int(user_id)
        if uid <= 0:
            raise HTTPException(status_code=400, detail="user_id должен быть положительным целым числом")
    except ValueError:
        raise HTTPException(status_code=400, detail="user_id должен быть числом")

    try:
        from bot import get_user_group
        grp = get_user_group(uid)
        return {"group": grp}
    except Exception as e:
        logger.warning(f"Error getting user group for {user_id}: {e}")
        return {"group": "ИСС9-25"}


@app.post("/api/user-group")
async def set_api_user_group(payload: UserGroupPayload, request: Request):
    """Сохранить выбранную группу пользователя Telegram с валидацией и защитой от IDOR."""
    user = get_verified_user_from_request(request)
    bot_token = os.getenv("BOT_TOKEN", "")

    # Fallback: если заголовок потерялся, но init_data передан в теле JSON
    if not user and payload.init_data and bot_token:
        user = verify_telegram_init_data(payload.init_data, bot_token)

    if not user:
        raise HTTPException(status_code=401, detail="Требуется авторизация Telegram")

    auth_id = user.get("id") or user.get("telegram_id")
    if auth_id and int(auth_id) != payload.user_id and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="ID пользователя не совпадает с сессией Telegram (IDOR защита)")

    clean_group = payload.group.strip()
    if not re.match(r"^[\w\s\-\.\(\)]+$", clean_group, re.UNICODE):
        raise HTTPException(status_code=400, detail="Недопустимые символы в названии группы")

    try:
        from bot import set_user_group
        set_user_group(payload.user_id, "", clean_group)
        return {"status": "success", "group": clean_group}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.warning(f"Error setting user group for {payload.user_id}: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка при сохранении группы")


# ── СИСТЕМА АВТОРИЗАЦИИ И АДМИН-ПАНЕЛЬ (БАН-ЛИСТ, АУДИТ, СТАТИСТИКА, МОНИТОРИНГ) ──

class AdminBanPayload(BaseModel):
    telegram_id: int = Field(..., gt=0)
    username: Optional[str] = ""
    reason: str = Field(..., min_length=1, description="Причина бана обязательна")
    duration: Optional[str] = "permanent"  # "1h", "24h", "7d", "permanent"
    action: Optional[str] = "ban"


class AdminMassBanPayload(BaseModel):
    telegram_ids: List[int] = Field(..., min_items=1)
    reason: str = Field(..., min_length=1, description="Причина бана обязательна")
    duration: Optional[str] = "permanent"


class ClientActivityPayload(BaseModel):
    group: Optional[str] = ""
    action: Optional[str] = ""
    platform: Optional[str] = ""


class ClientBugReportPayload(BaseModel):
    error_message: str = Field(..., min_length=1)
    stack_trace: Optional[str] = ""
    group_name: Optional[str] = ""
    url: Optional[str] = ""


def _parse_duration_to_hours(duration: Optional[str]) -> Optional[int]:
    if not duration or duration == "permanent":
        return None
    d = str(duration).lower().strip()
    if d in ("1h", "1"):
        return 1
    if d in ("24h", "24", "1d"):
        return 24
    if d in ("7d", "168h", "168"):
        return 168
    try:
        val = int(re.sub(r"[^\d]", "", d))
        return val if val > 0 else None
    except ValueError:
        return None


@app.post("/api/activity")
async def record_client_activity(request: Request, payload: ClientActivityPayload):
    """Прием heartbeat и событий активности от фронтенда (без блокировки неавторизованных)."""
    user = get_verified_user_from_request(request)
    client_ip = get_real_client_ip(request)
    now = time.time()
    uid = None
    username = ""
    first_name = ""

    if user:
        uid = int(user.get("id") or user.get("telegram_id") or 0)
        username = user.get("username", "")
        first_name = user.get("first_name", "")

    if uid and uid > 0:
        prev = _online_users.get(uid, {})
        _online_users[uid] = {
            "username": username or prev.get("username", ""),
            "first_name": first_name or prev.get("first_name", ""),
            "last_seen": now,
            "connected_at": prev.get("connected_at", now),
            "ip": client_ip,
            "group": payload.group or prev.get("group", ""),
            "last_action": payload.action or prev.get("last_action", "Активность"),
            "platform": payload.platform or prev.get("platform", "WebApp")
        }
        db.record_hourly_request(uid)
        db.upsert_user_activity(
            telegram_id=uid,
            username=username,
            group=payload.group or "",
            action=payload.action or "Активность",
            ip=client_ip,
            platform=payload.platform or "WebApp"
        )
    return {"status": "ok"}


@app.post("/api/report-bug")
async def report_client_bug(request: Request, payload: ClientBugReportPayload):
    """Регистрация ошибки или сбоя от клиента."""
    user = get_verified_user_from_request(request)
    uid = None
    if user:
        uid = int(user.get("id") or user.get("telegram_id") or 0)
    report_id = db.save_bug_report(
        telegram_id=uid,
        group_name=payload.group_name or "",
        error_message=payload.error_message,
        stack_trace=payload.stack_trace or "",
        url=payload.url or str(request.url)
    )
    return {"status": "ok", "report_id": report_id}


@app.get("/api/auth-status")
async def get_auth_status(request: Request):
    """Проверка статуса сессии: Telegram ID и статус владельца."""
    user = get_verified_user_from_request(request)
    if not user:
        return {"authenticated": False, "is_admin": False}
    if user.get("is_banned"):
        return {"authenticated": False, "is_admin": False, "is_banned": True}

    uid = user.get("id", 0)
    is_admin = is_admin_user(uid)

    return {
        "authenticated": True,
        "user_id": uid,
        "telegram_id": uid,
        "username": user.get("username", ""),
        "first_name": user.get("first_name", ""),
        "is_admin": is_admin,
        "is_banned": False,
    }


@app.get("/api/admin/info")
async def get_admin_info(request: Request):
    """Данные админ-панели (сводка). Доступ строго для владельца."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")

    banned = db.get_banned_users()
    stats = db.get_analytics_summary()
    return {
        "admin_id": user["id"],
        "banned_users": banned,
        "total_banned": len(banned),
        "stats": stats,
    }


@app.get("/api/admin/users")
async def get_admin_users(request: Request):
    """Детальная информация о пользователях: онлайн + история активности."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")

    now = time.time()
    online_list = []
    stale_keys = []
    for uid, info in _online_users.items():
        age = now - info.get("last_seen", 0)
        if age <= ONLINE_TTL:
            conn_time = info.get("connected_at", info.get("last_seen", now))
            online_list.append({
                "telegram_id": uid,
                "username": info.get("username", ""),
                "first_name": info.get("first_name", ""),
                "group": info.get("group", ""),
                "last_action": info.get("last_action", "Активен"),
                "ip": info.get("ip", "unknown"),
                "platform": info.get("platform", "WebApp"),
                "session_duration_sec": max(0, int(now - conn_time)),
                "last_seen_sec": int(age)
            })
        else:
            stale_keys.append(uid)

    for k in stale_keys:
        _online_users.pop(k, None)

    online_list.sort(key=lambda x: x["last_seen_sec"])
    history = db.get_user_activity_history(limit=50)

    return {
        "status": "ok",
        "online_users": online_list,
        "history": history,
        "total_online": len(online_list)
    }


@app.get("/api/admin/bans")
async def get_admin_bans(request: Request, search: Optional[str] = Query("", description="Поиск")):
    """Список заблокированных пользователей с фильтрацией."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")
    return {"status": "ok", "banned_users": db.get_banned_users(query=search or "")}


@app.post("/api/admin/bans")
async def manage_admin_bans(request: Request, payload: AdminBanPayload):
    """Блокировка или разблокировка пользователя с обязательной причиной и длительностью."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")

    if payload.action == "unban":
        db.unban_user(payload.telegram_id, admin_id=user["id"], reason=payload.reason or "Разблокировка")
    else:
        duration_hours = _parse_duration_to_hours(payload.duration)
        db.ban_user(
            telegram_id=payload.telegram_id,
            username=payload.username or "",
            reason=payload.reason,
            duration_hours=duration_hours,
            banned_by=user["id"]
        )

    return {"status": "ok", "banned_users": db.get_banned_users()}


@app.post("/api/admin/bans/mass")
async def mass_ban_admin(request: Request, payload: AdminMassBanPayload):
    """Массовая блокировка списка Telegram ID."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")

    duration_hours = _parse_duration_to_hours(payload.duration)
    banned_count = db.mass_ban_users(
        telegram_ids=payload.telegram_ids,
        reason=payload.reason,
        duration_hours=duration_hours,
        banned_by=user["id"]
    )
    return {"status": "ok", "banned_count": banned_count, "banned_users": db.get_banned_users()}


@app.delete("/api/admin/bans/{telegram_id}")
async def delete_admin_ban(
    request: Request,
    telegram_id: int,
    reason: Optional[str] = Query("Разблокировка администратором", description="Причина")
):
    """Быстрая разблокировка пользователя по ID."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")

    db.unban_user(telegram_id, admin_id=user["id"], reason=reason)
    return {"status": "ok"}


@app.get("/api/admin/audit-logs")
async def get_admin_audit(request: Request, limit: int = Query(50, ge=1, le=200)):
    """Журнал действий администраторов."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")
    return {"status": "ok", "logs": db.get_audit_logs(limit=limit)}


@app.get("/api/admin/stats")
async def get_admin_stats(request: Request):
    """Почасовая активность (24ч) и популярность групп."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")
    return {"status": "ok", "stats": db.get_analytics_summary()}


@app.get("/api/admin/reports")
async def get_admin_reports(request: Request, status: Optional[str] = Query("open", description="open, resolved или пусто")):
    """Список клиентских сообщений об ошибках и сбоях."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")
    return {"status": "ok", "reports": db.get_bug_reports(status=status)}


@app.post("/api/admin/reports/{report_id}/resolve")
async def resolve_admin_report(request: Request, report_id: int):
    """Отметка ошибки как решенной."""
    user = get_verified_user_from_request(request)
    if not user or not user.get("is_admin") or user.get("is_banned"):
        raise HTTPException(status_code=404, detail="Not Found")
    success = db.resolve_bug_report(report_id, admin_id=user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"status": "ok"}


@app.get("/api/english-alarm")
async def get_english_alarm(
    request: Request,
    group: Optional[str] = Query(None, description="Название группы")
):
    """Информация о ближайшем занятии по английскому языку / тревоге и обратный отсчет."""
    user = get_verified_user_from_request(request)
    if user and user.get("is_banned"):
        return {"found": False, "is_banned": True}
    target_group = (group or "ИСС9-25").strip()
    return await asyncio.to_thread(parser.get_upcoming_alarm, target_group, pattern=r"(англ|иностр)")


@app.get("/api/teachers")
async def get_teachers(
    tab: Optional[str] = Query(None, description="GID или название вкладки"),
    gid: Optional[str] = Query(None, description="GID или название вкладки (алиас)")
):
    """Список всех преподавателей."""
    selected_tab = tab or gid
    data = await asyncio.to_thread(parser.get_data, gid=selected_tab)
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
    data = await asyncio.to_thread(parser.get_data, gid=selected_tab)
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
    return {
        "teacher": teacher_norm,
        "days": _group_lessons_by_day(lessons),
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
    data = await asyncio.to_thread(parser.get_data, gid=selected_tab)
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
    data = await asyncio.to_thread(parser.get_data, gid=selected_tab)
    room_norm = room.strip()
    classroom_schedules = data.get("classroom_schedules", {})

    if room_norm not in classroom_schedules:
        matched = next((r for r in classroom_schedules if room_norm.lower() == r.lower()), None)
        if matched:
            room_norm = matched
        else:
            raise HTTPException(status_code=404, detail=f"Аудитория '{room}' не найдена")

    lessons = classroom_schedules.get(room_norm, [])
    return {
        "classroom": room_norm,
        "days": _group_lessons_by_day(lessons),
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
        tabs_info = await asyncio.to_thread(parser.get_tabs)
        tabs = tabs_info.get("tabs", [])
        active_gid = tabs_info.get("active_gid", "")

        data = await asyncio.to_thread(parser.get_data)
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
            "sync_errors_recent": parser.get_sync_errors()[-10:] if hasattr(parser, "get_sync_errors") else [],
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
                "sync_errors_recent": parser.get_sync_errors()[-10:] if hasattr(parser, "get_sync_errors") else [],
                "uptime_check": "FAIL",
            },
        )


@app.get("/api/sync-diagnostics")
async def sync_diagnostics():
    """Возвращает историю сбоев синхронизации с Google Sheets и состояние CircuitBreaker."""
    errors = parser.get_sync_errors() if hasattr(parser, "get_sync_errors") else []
    cb = _circuit_breaker.status_dict()
    return {
        "status": "ok",
        "circuit_breaker": cb,
        "total_errors_recorded": len(errors),
        "recent_errors": errors,
    }


@app.post("/api/refresh")
async def refresh_schedule(tab: Optional[str] = Query(None, description="GID или название вкладки")):
    """Принудительное обновление расписания из Google Sheets."""
    try:
        await asyncio.to_thread(parser.refresh_tabs, force=True)
        updated = await asyncio.to_thread(parser.get_data, gid=tab, force_refresh=True)
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
