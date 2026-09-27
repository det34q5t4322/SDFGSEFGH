import os
import time
import asyncio
import logging
import urllib.request
import urllib.error
import json
from typing import Optional, Set
from fastapi.responses import FileResponse, Response

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AVATAR_CACHE_DIR = os.path.join(BASE_DIR, "avatars_cache")
DEFAULT_AVATAR_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "static", "default-avatar.svg"))

os.makedirs(AVATAR_CACHE_DIR, exist_ok=True)

AVATAR_TTL_SECONDS = 86400  # 24 часа
NEGATIVE_CACHE_TTL_SECONDS = 86400  # 24 часа для пользователей без фото
MAX_CONCURRENT_DOWNLOADS = 5

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
_active_downloads: Set[int] = set()


def _get_api_urls() -> tuple[str, str, str]:
    """Возвращает (bot_token, base_api_url, file_api_url)."""
    token = os.getenv("BOT_TOKEN", "").strip()
    raw_api = os.getenv("TELEGRAM_API_URL", "https://api.telegram.org/bot").strip().rstrip("/")
    if raw_api.endswith("/bot"):
        base_api = f"{raw_api}{token}/"
        file_api = f"{raw_api.replace('/bot', '/file/bot')}{token}/"
    else:
        base_api = f"{raw_api}/bot{token}/"
        file_api = f"{raw_api}/file/bot{token}/"
    return token, base_api, file_api


def _sync_download_avatar(telegram_id: int) -> bool:
    """
    Синхронно обращается к Telegram Bot API, получает информацию об аватарке
    и сохраняет наилучший по размеру JPEG (160x160 или 320x320) на диск.
    Возвращает True, если фото успешно сохранено, False если фото нет или произошла ошибка.
    """
    token, base_api, file_api = _get_api_urls()
    if not token:
        logger.warning("BOT_TOKEN is not configured, cannot fetch Telegram avatars")
        return False

    cache_file = os.path.join(AVATAR_CACHE_DIR, f"{telegram_id}.jpg")
    no_avatar_marker = os.path.join(AVATAR_CACHE_DIR, f"{telegram_id}.no_avatar")
    tmp_file = os.path.join(AVATAR_CACHE_DIR, f"{telegram_id}.tmp")

    try:
        # 1. Запрос списка фото профиля пользователя
        photos_url = f"{base_api}getUserProfilePhotos?user_id={telegram_id}&limit=1"
        req = urllib.request.Request(photos_url, headers={"User-Agent": "ScheduleApp/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if not data.get("ok"):
            logger.warning(f"Telegram API error for user {telegram_id}: {data.get('description')}")
            return False

        result = data.get("result", {})
        photos = result.get("photos", [])
        if not photos or len(photos) == 0:
            # У пользователя нет фото профиля — кэшируем маркер отсутствия
            try:
                with open(no_avatar_marker, "w") as f:
                    f.write(str(int(time.time())))
                if os.path.exists(cache_file):
                    os.remove(cache_file)
            except OSError:
                pass
            return False

        # Выбираем подходящий размер: photos[0] отсортирован по возрастанию
        # [0] = 160x160 (~6KB), [1] = 320x320 (~15KB)
        sizes = photos[0]
        selected_size = sizes[1] if len(sizes) > 1 else sizes[0]
        file_id = selected_size.get("file_id")

        # 2. Получаем file_path
        get_file_url = f"{base_api}getFile?file_id={file_id}"
        req_file = urllib.request.Request(get_file_url, headers={"User-Agent": "ScheduleApp/1.0"})
        with urllib.request.urlopen(req_file, timeout=5) as resp_file:
            file_meta = json.loads(resp_file.read().decode("utf-8"))

        if not file_meta.get("ok"):
            return False

        file_path = file_meta.get("result", {}).get("file_path")
        if not file_path:
            return False

        # 3. Скачиваем файл изображения
        download_url = f"{file_api}{file_path}"
        req_dl = urllib.request.Request(download_url, headers={"User-Agent": "ScheduleApp/1.0"})
        with urllib.request.urlopen(req_dl, timeout=8) as resp_dl:
            img_bytes = resp_dl.read()

        if len(img_bytes) < 100:
            return False

        # Атомарное сохранение файла
        with open(tmp_file, "wb") as f:
            f.write(img_bytes)
        os.replace(tmp_file, cache_file)

        # Удаляем маркер отсутствия, если он существовал
        if os.path.exists(no_avatar_marker):
            try:
                os.remove(no_avatar_marker)
            except OSError:
                pass

        logger.info(f"Cached avatar for user {telegram_id} ({len(img_bytes)} bytes)")
        return True

    except Exception as e:
        logger.warning(f"Failed to fetch avatar for {telegram_id}: {e}")
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except OSError:
                pass
        return False


async def refresh_user_avatar(telegram_id: int):
    """Асинхронная обёртка с семафором и защитой от дубликатов."""
    if telegram_id in _active_downloads:
        return
    _active_downloads.add(telegram_id)
    try:
        async with _semaphore:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _sync_download_avatar, telegram_id)
    finally:
        _active_downloads.discard(telegram_id)


async def get_avatar_response(telegram_id: int) -> Response:
    """
    Основной обработчик GET /api/avatar/{telegram_id}:
    - Проверяет валидность ID
    - Отдаёт закэшированный JPEG, если он есть
    - При устаревании кэша (>24ч) запускает фоновое обновление
    - При отсутствии кэша скачивает синхронно с таймаутом
    - При ошибке или отсутствии фото возвращает SVG-заглушку
    """
    if telegram_id <= 0 or telegram_id > 100_000_000_000:
        return _default_avatar_response()

    cache_file = os.path.join(AVATAR_CACHE_DIR, f"{telegram_id}.jpg")
    no_avatar_marker = os.path.join(AVATAR_CACHE_DIR, f"{telegram_id}.no_avatar")
    now = time.time()

    # 1. Файл есть в дисковом кэше
    if os.path.exists(cache_file):
        try:
            mtime = os.path.getmtime(cache_file)
            if now - mtime > AVATAR_TTL_SECONDS:
                # Ленивое фоновое обновление, не задерживая ответ
                asyncio.create_task(refresh_user_avatar(telegram_id))
            return FileResponse(
                cache_file,
                media_type="image/jpeg",
                headers={
                    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                    "X-Avatar-Cache": "HIT"
                }
            )
        except OSError:
            pass

    # 2. Есть маркер отсутствия фото
    if os.path.exists(no_avatar_marker):
        try:
            mtime = os.path.getmtime(no_avatar_marker)
            if now - mtime > NEGATIVE_CACHE_TTL_SECONDS:
                asyncio.create_task(refresh_user_avatar(telegram_id))
            return _default_avatar_response(cache_tag="NEGATIVE-HIT")
        except OSError:
            pass

    # 3. Ни файла, ни маркера нет — первоначальная попытка скачивания
    try:
        # Ограничиваем ожидание первого скачивания 2.5 секундами, чтобы клиент не зависал
        loop = asyncio.get_event_loop()
        success = await asyncio.wait_for(
            loop.run_in_executor(None, _sync_download_avatar, telegram_id),
            timeout=2.5
        )
        if success and os.path.exists(cache_file):
            return FileResponse(
                cache_file,
                media_type="image/jpeg",
                headers={
                    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                    "X-Avatar-Cache": "MISS-STORED"
                }
            )
    except (asyncio.TimeoutError, Exception) as e:
        logger.warning(f"Initial avatar fetch timeout/error for {telegram_id}: {e}")

    # Fallback на дефолтный аватар
    return _default_avatar_response(cache_tag="DEFAULT")


def _default_avatar_response(cache_tag: str = "DEFAULT") -> Response:
    if os.path.exists(DEFAULT_AVATAR_PATH):
        return FileResponse(
            DEFAULT_AVATAR_PATH,
            media_type="image/svg+xml",
            headers={
                "Cache-Control": "public, max-age=3600",
                "X-Avatar-Cache": cache_tag
            }
        )
    # Inline fallback SVG, если файла на диске нет
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
        '<rect width="128" height="128" rx="64" fill="#1e293b"/>'
        '<circle cx="64" cy="48" r="22" fill="#64748b"/>'
        '<path d="M26 108 C26 84, 42 76, 64 76 C86 76, 102 84, 102 108 Z" fill="#64748b"/>'
        '</svg>'
    )
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Avatar-Cache": f"{cache_tag}-INLINE"
        }
    )
