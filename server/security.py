import os
import time
import json
import hmac
import hashlib
import urllib.parse
import logging
from typing import Optional, Dict, Any, Set
try:
    from db import is_user_banned
except ImportError:
    from server.db import is_user_banned

logger = logging.getLogger(__name__)

raw_admin_ids = os.getenv("ADMIN_TELEGRAM_ID", "7552844207")
ADMIN_TELEGRAM_IDS: Set[int] = set()
for part in raw_admin_ids.split(","):
    part = part.strip()
    if part.isdigit():
        ADMIN_TELEGRAM_IDS.add(int(part))


def is_admin_user(telegram_id: Optional[int]) -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    return telegram_id in ADMIN_TELEGRAM_IDS


def verify_telegram_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: int = 604800  # 7 дней
) -> Optional[Dict[str, Any]]:
    """
    Валидация подписи initData из Telegram WebApp:
    - Проверка наличия обязательных полей (hash, auth_date, user).
    - Проверка времени подписи (auth_date не старше max_age_seconds и не из будущего >1ч).
    - Криптографическая проверка HMAC-SHA256 через секретный ключ WebAppData.
    - Извлечение ID пользователя и проверка статуса администратора и бана.
    """
    if not init_data or not bot_token:
        return None

    try:
        parsed = urllib.parse.parse_qsl(init_data, keep_blank_values=True)
        data_dict = dict(parsed)
        received_hash = data_dict.pop("hash", None)
        if not received_hash:
            return None

        raw_auth_date = data_dict.get("auth_date")
        if not raw_auth_date:
            return None

        try:
            auth_date = int(raw_auth_date)
            now = int(time.time())
            if (now - auth_date) > max_age_seconds or auth_date > (now + 3600):
                return None
        except (ValueError, TypeError):
            return None

        check_items = [f"{k}={v}" for k, v in sorted(data_dict.items())]
        data_check_string = "\n".join(check_items)
        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(calculated_hash, received_hash):
            return None

        user_json = data_dict.get("user")
        if not user_json:
            return None

        try:
            user_info = json.loads(user_json)
        except Exception:
            return None

        raw_id = user_info.get("id")
        if raw_id is None:
            return None
        try:
            uid = int(raw_id)
            if uid <= 0:
                return None
            user_info["id"] = uid
        except (ValueError, TypeError):
            return None

        user_info["auth_date"] = auth_date
        user_info["is_admin"] = is_admin_user(uid)
        user_info["is_banned"] = is_user_banned(uid)

        return user_info

    except Exception as e:
        logger.warning(f"initData verification error: {e}")
        return None


def generate_mock_init_data(user_id: int, username: str = "tester", bot_token: str = "", auth_date_offset: int = 0) -> str:
    user_dict = {"id": user_id, "first_name": "Test", "username": username}
    user_json = json.dumps(user_dict, ensure_ascii=False)
    auth_date = str(int(time.time()) + auth_date_offset)
    data_dict = {
        "auth_date": auth_date,
        "query_id": "AAH_test_query",
        "user": user_json
    }
    check_items = [f"{k}={v}" for k, v in sorted(data_dict.items())]
    data_check_string = "\n".join(check_items)
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    calchash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    data_dict["hash"] = calchash
    return urllib.parse.urlencode(data_dict)


import base64

def get_auth_secret_key(bot_token: Optional[str] = None) -> bytes:
    token = bot_token or os.getenv("BOT_TOKEN", "fallback_college_schedule_secret_key_2026")
    return hashlib.sha256(f"telegram_auth_secret_{token}".encode("utf-8")).digest()


def generate_telegram_auth_token(user_info: Dict[str, Any], bot_token: Optional[str] = None, expires_days: int = 180) -> str:
    """Генерирует криптографически подписанный токен сессии для авторизации вне Telegram WebApp."""
    secret_key = get_auth_secret_key(bot_token)
    payload = {
        "id": int(user_info["id"]),
        "username": user_info.get("username", "") or "",
        "first_name": user_info.get("first_name", "") or "",
        "photo_url": user_info.get("photo_url", "") or "",
        "iat": int(time.time()),
        "exp": int(time.time()) + (expires_days * 86400),
    }
    payload_raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_raw).decode("utf-8").rstrip("=")
    sig = hmac.new(secret_key, payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_telegram_auth_token(token_str: str, bot_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Проверяет подпись и срок действия токена сессии."""
    if not token_str or "." not in token_str:
        return None
    try:
        parts = token_str.strip().split(".")
        if len(parts) != 2:
            return None
        payload_b64, received_sig = parts[0], parts[1]
        secret_key = get_auth_secret_key(bot_token)
        expected_sig = hmac.new(secret_key, payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_sig, received_sig):
            return None
        padding = 4 - (len(payload_b64) % 4)
        if padding != 4:
            payload_b64 += "=" * padding
        payload_raw = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
        payload = json.loads(payload_raw)

        uid = int(payload.get("id", 0))
        if uid <= 0:
            return None
        exp = int(payload.get("exp", 0))
        if time.time() > exp:
            return None

        user_info = {
            "id": uid,
            "telegram_id": uid,
            "username": payload.get("username", "") or "",
            "first_name": payload.get("first_name", "") or "",
            "photo_url": payload.get("photo_url", "") or "",
            "is_admin": is_admin_user(uid),
            "is_banned": is_user_banned(uid),
        }
        return user_info
    except Exception as e:
        logger.warning(f"Auth token verification error: {e}")
        return None


