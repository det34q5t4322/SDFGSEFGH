"""
Шифрование конфиденциальных данных (паролей и cookies 1C)
через cryptography.fernet.
Ключ шифрования (GRADES_FERNET_KEY) хранится в .env.
Если ключ не найден, генерируется автоматически и дописывается в .env.
"""

import os
import json
import logging
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")

def _get_or_create_key() -> str:
    key = os.environ.get("GRADES_FERNET_KEY")
    if not key and os.path.exists(_ENV_PATH):
        try:
            with open(_ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("GRADES_FERNET_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        os.environ["GRADES_FERNET_KEY"] = key
                        break
        except Exception as e:
            logger.warning(f"Ошибка чтения .env для GRADES_FERNET_KEY: {e}")

    if not key:
        # Генерируем новый ключ
        new_key = Fernet.generate_key().decode("utf-8")
        os.environ["GRADES_FERNET_KEY"] = new_key
        try:
            with open(_ENV_PATH, "a", encoding="utf-8") as f:
                f.write(f"\nGRADES_FERNET_KEY={new_key}\n")
            logger.info("GRADES_FERNET_KEY успешно сгенерирован и сохранён в .env")
        except Exception as e:
            logger.warning(f"Не удалось записать GRADES_FERNET_KEY в .env: {e}")
        key = new_key

    return key

def _get_fernet() -> Fernet:
    key = _get_or_create_key()
    return Fernet(key.encode("utf-8") if isinstance(key, str) else key)

def encrypt_text(text: str) -> str:
    """Шифрует произвольную строку, возвращает urlsafe base64 строку."""
    if not text:
        return ""
    fernet = _get_fernet()
    return fernet.encrypt(text.encode("utf-8")).decode("utf-8")

def decrypt_text(token: str) -> str:
    """Расшифровывает зашифрованную строку."""
    if not token:
        return ""
    fernet = _get_fernet()
    try:
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        raise ValueError("Неверный токен или ключ шифрования изменился")

def encrypt_cookies(cookies: dict) -> str:
    """Сериализует словарь cookies в JSON и шифрует."""
    return encrypt_text(json.dumps(cookies))

def decrypt_cookies(encrypted_str: str) -> dict:
    """Расшифровывает строку и восстанавливает словарь cookies."""
    if not encrypted_str:
        return {}
    raw = decrypt_text(encrypted_str)
    return json.loads(raw)
