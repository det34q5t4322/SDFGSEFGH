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
    max_age_seconds: int = 3600
)-> Optional[Dict[str, Any]]:
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
            if (now - auth_date) > max_age_seconds or auth_date > (now + 300):
                return None
        except ValueError:
            return None

        check_items = [f"{k}={v}" for k, v in sorted(data_dict.items())]
        data_check_string = "\n".join(check_items)
        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(calculated_hash, received_hash):
            return None

        user_json = data_dict.get("user")
        user_info: Dict[str, Any] = {}
        if user_json:
            try:
                user_info = json.loads(user_json)
            except Exception:
                pass

        user_id = user_info.get("id")
        if user_id:
            user_info["id"] = int(user_id)
            user_info["is_admin"] = is_admin_user(user_info["id"])
            user_info["is_banned"] = is_user_banned(user_info["id"])

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
