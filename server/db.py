import os
import sqlite3
import logging
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS notes_authors (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT DEFAULT '',
                    added_at TEXT NOT NULL
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS banned_users (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT DEFAULT "",
                    reason TEXT DEFAULT '',
                    banned_at TEXT NOT NULL
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS lesson_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_name TEXT NOT NULL,
                    day_key TEXT NOT NULL,
                    pair_num INTEGER NOT NULL,
                    subject TEXT DEFAULT "",
                    text TEXT NOT NULL,
                    updated_by INTEGER NOT NULL,
                    updated_by_name TEXT DEFAULT '',
                    updated_at TEXT NOT NULL,
                    UNIQUE(group_name, day_key, pair_num)
                )
            ''')
            conn.commit()
            logger.info(f'SQLite DB initialized: {DB_PATH}')
    except Exception as e:
        logger.error(f'SQLite init error: {e}')


def is_user_banned(telegram_id: int) -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT 1 FROM banned_users WHERE telegram_id = ?', (telegram_id,))
            return cursor.fetchone() is not None
    except Exception as e:
        logger.error(f'Error checking ban for {telegram_id}: {e}')
        return False


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


def unban_user(telegram_id: int) -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM banned_users WHERE telegram_id = ?', (telegram_id,))
        conn.commit()
        return cursor.rowcount > 0


def get_banned_users() -> List[Dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT telegram_id, username, reason, banned_at FROM banned_users ORDER BY banned_at DESC')
        return [dict(row) for row in cursor.fetchall()]


def is_notes_author(telegram_id: int) -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT 1 FROM notes_authors WHERE telegram_id = ?', (telegram_id,))
            return cursor.fetchone() is not None
    except Exception as e:
        logger.error(f'Error checking author for {telegram_id}: {e}')
        return False


def add_notes_author(telegram_id: int, username: str = "") -> None:
    if not telegram_id or telegram_id <= 0:
        return
    with get_db_connection() as conn:
        cursor = conn.cursor()
        now_iso = datetime.now().isoformat()
        cursor.execute('''
            INSERT INTO notes_authors (telegram_id, username, added_at)
            VALUES (?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
                username = excluded.username,
                added_at = excluded.added_at
        ''', (telegram_id, username or "", now_iso))
        conn.commit()


def remove_notes_author(telegram_id: int) -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM notes_authors WHERE telegram_id = ?', (telegram_id,))
        conn.commit()
        return cursor.rowcount > 0


def get_notes_authors() -> List[Dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT telegram_id, username, added_at FROM notes_authors ORDER BY added_at DESC')
        return [dict(row) for row in cursor.fetchall()]


def get_notes_for_group(group_name: str) -> List[Dict]:
    clean_group = (group_name or "").strip()
    if not clean_group:
        return []
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, group_name, day_key, pair_num, subject, text, updated_by, updated_by_name, updated_at
            FROM lesson_notes
            WHERE group_name = ?
            ORDER BY day_key, pair_num
        ''', (clean_group,))
        return [dict(row) for row in cursor.fetchall()]


def get_lesson_note(group_name: str, day_key: str, pair_num: int) -> Optional[Dict]:
    clean_group = (group_name or "").strip()
    clean_day = (day_key or "").strip()
    if not clean_group or not clean_day:
        return None
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, group_name, day_key, pair_num, subject, text, updated_by, updated_by_name, updated_at
            FROM lesson_notes
            WHERE group_name = ? AND day_key = ? AND pair_num = ?
        ''', (clean_group, clean_day, int(pair_num)))
        row = cursor.fetchone()
        return dict(row) if row else None


def save_lesson_note(
    group_name: str,
    day_key: str,
    pair_num: int,
    subject: str,
    text: str,
    updated_by: int,
    updated_by_name: str = ""
) -> Dict:
    clean_group = (group_name or "").strip()
    clean_day = (day_key or "").strip()
    clean_text = (text or "").strip()
    clean_subject = (subject or "").strip()
    now_iso = datetime.now().isoformat()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO lesson_notes (group_name, day_key, pair_num, subject, text, updated_by, updated_by_name, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(group_name, day_key, pair_num) DO UPDATE SET
                subject = excluded.subject,
                text = excluded.text,
                updated_by = excluded.updated_by,
                updated_by_name = excluded.updated_by_name,
                updated_at = excluded.updated_at
        ''', (clean_group, clean_day, int(pair_num), clean_subject, clean_text, updated_by, updated_by_name or "", now_iso))
        conn.commit()

        return {
            'group_name': clean_group,
            'day_key': clean_day,
            'pair_num': int(pair_num),
            'subject': clean_subject,
            'text': clean_text,
            'updated_by': updated_by,
            'updated_by_name': updated_by_name,
            'updated_at': now_iso,
        }


def get_notes_count() -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM lesson_notes')
        row = cursor.fetchone()
        return row[0] if row else 0


init_db()
