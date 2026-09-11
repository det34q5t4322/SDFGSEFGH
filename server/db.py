import os
import sqlite3
import logging
import threading
from typing import Dict, List, Optional, Set
from datetime import datetime

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')

# In-memory кэш для моментальной O(1) проверки без дискового I/O на каждый HTTP-запрос
_banned_ids_cache: Set[int] = set()
_cache_lock = threading.Lock()


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Настройка высокой производительности и защиты от блокировок
            cursor.execute('PRAGMA journal_mode = WAL;')
            cursor.execute('PRAGMA busy_timeout = 5000;')
            cursor.execute('PRAGMA synchronous = NORMAL;')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS banned_users (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT DEFAULT "",
                    reason TEXT DEFAULT '',
                    banned_at TEXT NOT NULL
                )
            ''')
            conn.commit()

            # Загрузка списка бана в память
            cursor.execute('SELECT telegram_id FROM banned_users')
            banned_set = {int(row[0]) for row in cursor.fetchall()}

            with _cache_lock:
                _banned_ids_cache.clear()
                _banned_ids_cache.update(banned_set)

            logger.info(f'SQLite DB initialized in WAL mode ({len(banned_set)} banned): {DB_PATH}')
    except Exception as e:
        logger.error(f'SQLite init error: {e}')


def is_user_banned(telegram_id: int) -> bool:
    """Моментальная проверка статуса бана из памяти (O(1), 0 дисковых обращений)."""
    if not telegram_id or telegram_id <= 0:
        return False
    with _cache_lock:
        return telegram_id in _banned_ids_cache


def ban_user(telegram_id: int, username: str = "", reason: str = "") -> None:
    if not telegram_id or telegram_id <= 0:
        return
    with get_db_connection() as conn:
        cursor = conn.cursor()
        now_iso = datetime.now().isoformat()
        cursor.execute('''
            INSERT INTO banned_users (telegram_id, username, reason, banned_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
                username = excluded.username,
                reason = excluded.reason,
                banned_at = excluded.banned_at
        ''', (telegram_id, username or "", reason or "", now_iso))
        conn.commit()
    with _cache_lock:
        _banned_ids_cache.add(telegram_id)


def unban_user(telegram_id: int) -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM banned_users WHERE telegram_id = ?', (telegram_id,))
        conn.commit()
        success = cursor.rowcount > 0
    with _cache_lock:
        _banned_ids_cache.discard(telegram_id)
    return success


def get_banned_users() -> List[Dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT telegram_id, username, reason, banned_at FROM banned_users ORDER BY banned_at DESC')
        return [dict(row) for row in cursor.fetchall()]


init_db()

