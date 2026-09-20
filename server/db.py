import os
import sqlite3
import logging
import threading
from typing import Dict, List, Optional, Set, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')

# In-memory кэш для моментальной O(1) проверки бана: telegram_id -> banned_until (ISO text or None)
_banned_users_map: Dict[int, Optional[str]] = {}
_cache_lock = threading.Lock()


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('PRAGMA journal_mode = WAL;')
            cursor.execute('PRAGMA busy_timeout = 5000;')
            cursor.execute('PRAGMA synchronous = NORMAL;')

            # 1. Banned Users
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS banned_users (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT DEFAULT "",
                    reason TEXT DEFAULT "",
                    banned_at TEXT NOT NULL,
                    banned_until TEXT,
                    banned_by INTEGER DEFAULT 0
                )
            ''')

            # Миграция колонок, если таблица была создана ранее без них
            cursor.execute("PRAGMA table_info(banned_users)")
            existing_cols = {row['name'] for row in cursor.fetchall()}
            if 'banned_until' not in existing_cols:
                cursor.execute("ALTER TABLE banned_users ADD COLUMN banned_until TEXT")
            if 'banned_by' not in existing_cols:
                cursor.execute("ALTER TABLE banned_users ADD COLUMN banned_by INTEGER DEFAULT 0")

            # 2. Admin Audit Logs
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS admin_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_id INTEGER NOT NULL,
                    target_id INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    reason TEXT DEFAULT "",
                    duration TEXT DEFAULT "",
                    created_at TEXT NOT NULL
                )
            ''')

            # 3. User Activity History
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS user_activity (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT DEFAULT "",
                    first_name TEXT DEFAULT "",
                    photo_url TEXT DEFAULT "",
                    selected_group TEXT DEFAULT "",
                    last_action TEXT DEFAULT "",
                    ip_address TEXT DEFAULT "",
                    platform TEXT DEFAULT "",
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    visits_count INTEGER DEFAULT 1,
                    total_time_seconds INTEGER DEFAULT 0,
                    game_time_seconds INTEGER DEFAULT 0,
                    leaderboard_opt_in INTEGER DEFAULT 1
                )
            ''')

            # Миграция колонок для user_activity
            cursor.execute("PRAGMA table_info(user_activity)")
            act_cols = {row['name'] for row in cursor.fetchall()}
            if 'first_name' not in act_cols:
                cursor.execute("ALTER TABLE user_activity ADD COLUMN first_name TEXT DEFAULT ''")
            if 'photo_url' not in act_cols:
                cursor.execute("ALTER TABLE user_activity ADD COLUMN photo_url TEXT DEFAULT ''")
            if 'total_time_seconds' not in act_cols:
                cursor.execute("ALTER TABLE user_activity ADD COLUMN total_time_seconds INTEGER DEFAULT 0")
            if 'game_time_seconds' not in act_cols:
                cursor.execute("ALTER TABLE user_activity ADD COLUMN game_time_seconds INTEGER DEFAULT 0")
            if 'leaderboard_opt_in' not in act_cols:
                cursor.execute("ALTER TABLE user_activity ADD COLUMN leaderboard_opt_in INTEGER DEFAULT 1")

            # 3.1 User Game Stats
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS user_game_stats (
                    telegram_id INTEGER NOT NULL,
                    game_id TEXT NOT NULL,
                    high_score INTEGER DEFAULT 0,
                    total_time_seconds INTEGER DEFAULT 0,
                    last_played TEXT NOT NULL,
                    PRIMARY KEY (telegram_id, game_id)
                )
            ''')

            # Одноразовая нормализация завышенных счетчиков визитов
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )
            ''')
            cursor.execute("SELECT 1 FROM schema_migrations WHERE version = 'reset_inflated_visits_v1'")
            if not cursor.fetchone():
                cursor.execute("UPDATE user_activity SET visits_count = 1 WHERE visits_count > 1")
                cursor.execute("INSERT INTO schema_migrations (version, applied_at) VALUES ('reset_inflated_visits_v1', ?)", (datetime.now().isoformat(),))

            # По умолчанию включаем участие в таблице лидеров
            cursor.execute("SELECT 1 FROM schema_migrations WHERE version = 'default_leaderboard_opt_in_v1'")
            if not cursor.fetchone():
                cursor.execute("UPDATE user_activity SET leaderboard_opt_in = 1 WHERE leaderboard_opt_in = 0")
                cursor.execute("INSERT INTO schema_migrations (version, applied_at) VALUES ('default_leaderboard_opt_in_v1', ?)", (datetime.now().isoformat(),))

            # 4. Hourly Statistics
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS hourly_stats (
                    hour_key TEXT PRIMARY KEY,
                    requests_count INTEGER DEFAULT 0,
                    unique_users INTEGER DEFAULT 0
                )
            ''')

            # 5. Client Bug Reports
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS client_bug_reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id INTEGER,
                    group_name TEXT DEFAULT "",
                    error_message TEXT NOT NULL,
                    stack_trace TEXT DEFAULT "",
                    url TEXT DEFAULT "",
                    created_at TEXT NOT NULL,
                    status TEXT DEFAULT "open"
                )
            ''')

            conn.commit()

            # Загрузка активных банов в память
            cursor.execute('SELECT telegram_id, banned_until FROM banned_users')
            loaded_map = {}
            now_iso = datetime.now().isoformat()
            expired_ids = []

            for row in cursor.fetchall():
                tid = int(row['telegram_id'])
                b_until = row['banned_until']
                if b_until and b_until < now_iso:
                    expired_ids.append(tid)
                else:
                    loaded_map[tid] = b_until

            # Удаляем уже истекшие временные баны
            if expired_ids:
                cursor.executemany('DELETE FROM banned_users WHERE telegram_id = ?', [(tid,) for tid in expired_ids])
                conn.commit()
                logger.info(f'Cleared {len(expired_ids)} expired temporary bans during startup')

            with _cache_lock:
                _banned_users_map.clear()
                _banned_users_map.update(loaded_map)

            logger.info(f'SQLite DB initialized in WAL mode ({len(loaded_map)} active bans): {DB_PATH}')
    except Exception as e:
        logger.error(f'SQLite init error: {e}')


def is_user_banned(telegram_id: int) -> bool:
    """Проверка бана из памяти (O(1)). Если срок бана истёк — снимает бан автоматически."""
    if not telegram_id or telegram_id <= 0:
        return False

    with _cache_lock:
        if telegram_id not in _banned_users_map:
            return False
        banned_until = _banned_users_map[telegram_id]

    if banned_until:
        if datetime.now().isoformat() >= banned_until:
            # Срок бана истёк — авторазбан
            unban_user(telegram_id, admin_id=0, reason="Истечение срока временного бана")
            return False

    return True


def ban_user(
    telegram_id: int,
    username: str = "",
    reason: str = "Нарушение правил",
    duration_hours: Optional[int] = None,
    banned_by: int = 0
) -> None:
    if not telegram_id or telegram_id <= 0:
        return

    now = datetime.now()
    now_iso = now.isoformat()
    banned_until = None
    duration_label = "навсегда"

    if duration_hours and duration_hours > 0:
        banned_until_dt = now + timedelta(hours=duration_hours)
        banned_until = banned_until_dt.isoformat()
        if duration_hours == 1:
            duration_label = "1 час"
        elif duration_hours == 24:
            duration_label = "24 часа"
        elif duration_hours == 168:
            duration_label = "7 дней"
        else:
            duration_label = f"{duration_hours} ч"

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO banned_users (telegram_id, username, reason, banned_at, banned_until, banned_by)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
                username = excluded.username,
                reason = excluded.reason,
                banned_at = excluded.banned_at,
                banned_until = excluded.banned_until,
                banned_by = excluded.banned_by
        ''', (telegram_id, username or "", reason or "Нарушение правил", now_iso, banned_until, banned_by))

        # Логируем в аудит
        cursor.execute('''
            INSERT INTO admin_audit_logs (admin_id, target_id, action, reason, duration, created_at)
            VALUES (?, ?, "ban", ?, ?, ?)
        ''', (banned_by, telegram_id, reason or "Нарушение правил", duration_label, now_iso))

        conn.commit()

    with _cache_lock:
        _banned_users_map[telegram_id] = banned_until


def mass_ban_users(
    telegram_ids: List[int],
    reason: str = "Массовая блокировка",
    duration_hours: Optional[int] = None,
    banned_by: int = 0
) -> int:
    count = 0
    now = datetime.now()
    now_iso = now.isoformat()
    banned_until = None
    duration_label = "навсегда"

    if duration_hours and duration_hours > 0:
        banned_until = (now + timedelta(hours=duration_hours)).isoformat()
        duration_label = f"{duration_hours} ч"

    with get_db_connection() as conn:
        cursor = conn.cursor()
        for tid in telegram_ids:
            if not tid or tid <= 0:
                continue
            cursor.execute('''
                INSERT INTO banned_users (telegram_id, username, reason, banned_at, banned_until, banned_by)
                VALUES (?, "", ?, ?, ?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                    reason = excluded.reason,
                    banned_at = excluded.banned_at,
                    banned_until = excluded.banned_until,
                    banned_by = excluded.banned_by
            ''', (tid, reason, now_iso, banned_until, banned_by))

            cursor.execute('''
                INSERT INTO admin_audit_logs (admin_id, target_id, action, reason, duration, created_at)
                VALUES (?, ?, "mass_ban", ?, ?, ?)
            ''', (banned_by, tid, reason, duration_label, now_iso))

            with _cache_lock:
                _banned_users_map[tid] = banned_until
            count += 1

        conn.commit()
    return count


def unban_user(telegram_id: int, admin_id: int = 0, reason: str = "") -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM banned_users WHERE telegram_id = ?', (telegram_id,))
        success = cursor.rowcount > 0
        if success:
            now_iso = datetime.now().isoformat()
            cursor.execute('''
                INSERT INTO admin_audit_logs (admin_id, target_id, action, reason, duration, created_at)
                VALUES (?, ?, "unban", ?, "", ?)
            ''', (admin_id, telegram_id, reason or "Разблокировка", now_iso))
        conn.commit()

    with _cache_lock:
        _banned_users_map.pop(telegram_id, None)

    return success


def get_banned_users(query: str = "") -> List[Dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if query.strip():
            pattern = f"%{query.strip()}%"
            cursor.execute('''
                SELECT telegram_id, username, reason, banned_at, banned_until, banned_by
                FROM banned_users
                WHERE CAST(telegram_id AS TEXT) LIKE ? OR reason LIKE ? OR username LIKE ?
                ORDER BY banned_at DESC
            ''', (pattern, pattern, pattern))
        else:
            cursor.execute('''
                SELECT telegram_id, username, reason, banned_at, banned_until, banned_by
                FROM banned_users
                ORDER BY banned_at DESC
            ''')
        return [dict(row) for row in cursor.fetchall()]


def get_audit_logs(limit: int = 50) -> List[Dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, admin_id, target_id, action, reason, duration, created_at
            FROM admin_audit_logs
            ORDER BY id DESC
            LIMIT ?
        ''', (limit,))
        return [dict(row) for row in cursor.fetchall()]


def upsert_user_activity(
    telegram_id: int,
    username: str = "",
    first_name: str = "",
    photo_url: str = "",
    group: str = "",
    action: str = "",
    ip: str = "",
    platform: str = "",
    time_delta_seconds: int = 0,
    leaderboard_opt_in: Optional[bool] = None,
    is_new_session: bool = False
) -> None:
    """
    Запись активности пользователя:
    - visits_count инкрементируется СТРОГО при новой сессии (открытие приложения / тайм-аут > 30 мин).
    - Обычные heartbeats (каждые 15 сек) обновляют только last_seen, last_action и total_time_seconds.
    """
    if not telegram_id or telegram_id <= 0:
        return
    now_iso = datetime.now().isoformat()
    # Anti-cheat: максимум 90 секунд за один батч-heartbeat
    valid_time_delta = min(max(0, int(time_delta_seconds or 0)), 90)
    opt_in_val = 0 if leaderboard_opt_in is False else (1 if leaderboard_opt_in is True else None)
    visit_inc = 1 if is_new_session else 0

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO user_activity (
                telegram_id, username, first_name, photo_url, selected_group,
                last_action, ip_address, platform, first_seen, last_seen,
                visits_count, total_time_seconds, leaderboard_opt_in
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, COALESCE(?, 1))
            ON CONFLICT(telegram_id) DO UPDATE SET
                username = CASE WHEN excluded.username != "" THEN excluded.username ELSE user_activity.username END,
                first_name = CASE WHEN excluded.first_name != "" THEN excluded.first_name ELSE user_activity.first_name END,
                photo_url = CASE WHEN excluded.photo_url != "" THEN excluded.photo_url ELSE user_activity.photo_url END,
                selected_group = CASE WHEN excluded.selected_group != "" THEN excluded.selected_group ELSE user_activity.selected_group END,
                last_action = excluded.last_action,
                ip_address = excluded.ip_address,
                platform = excluded.platform,
                last_seen = excluded.last_seen,
                visits_count = user_activity.visits_count + ?,
                total_time_seconds = user_activity.total_time_seconds + excluded.total_time_seconds,
                leaderboard_opt_in = CASE WHEN ? IS NOT NULL THEN ? ELSE user_activity.leaderboard_opt_in END
        ''', (
            telegram_id, username or "", first_name or "", photo_url or "", group or "",
            action or "", ip or "", platform or "", now_iso, now_iso,
            valid_time_delta, opt_in_val,
            visit_inc, opt_in_val, opt_in_val
        ))
        conn.commit()


def set_leaderboard_opt_in(telegram_id: int, enabled: bool) -> bool:
    if not telegram_id or telegram_id <= 0:
        return False
    val = 1 if enabled else 0
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE user_activity
            SET leaderboard_opt_in = ?
            WHERE telegram_id = ?
        ''', (val, telegram_id))
        conn.commit()
        return cursor.rowcount > 0


def get_leaderboard(limit: int = 20, requesting_user_id: Optional[int] = None) -> Dict:
    now_iso = datetime.now().isoformat()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT telegram_id, username, first_name, photo_url, selected_group, total_time_seconds
            FROM user_activity
            WHERE COALESCE(leaderboard_opt_in, 1) = 1
              AND telegram_id NOT IN (
                  SELECT telegram_id FROM banned_users
                  WHERE banned_until IS NULL OR banned_until > ?
              )
            ORDER BY total_time_seconds DESC, last_seen DESC
            LIMIT ?
        ''', (now_iso, limit))
        top_users = [dict(row) for row in cursor.fetchall()]

        user_stats = None
        if requesting_user_id and requesting_user_id > 0:
            cursor.execute('''
                SELECT telegram_id, username, first_name, photo_url, selected_group, total_time_seconds, leaderboard_opt_in
                FROM user_activity
                WHERE telegram_id = ?
            ''', (requesting_user_id,))
            u_row = cursor.fetchone()
            if u_row:
                user_dict = dict(u_row)
                is_opted = user_dict.get('leaderboard_opt_in') is None or (user_dict.get('leaderboard_opt_in') != 0 and user_dict.get('leaderboard_opt_in') is not False)
                if is_opted:
                    cursor.execute('''
                        SELECT COUNT(*) + 1 as rank
                        FROM user_activity
                        WHERE COALESCE(leaderboard_opt_in, 1) = 1
                          AND telegram_id NOT IN (
                              SELECT telegram_id FROM banned_users
                              WHERE banned_until IS NULL OR banned_until > ?
                          )
                          AND total_time_seconds > ?
                    ''', (now_iso, user_dict.get('total_time_seconds', 0)))
                    rank_row = cursor.fetchone()
                    user_dict['rank'] = rank_row['rank'] if rank_row else 1
                else:
                    user_dict['rank'] = None
                user_stats = user_dict

        return {
            "top_users": top_users,
            "user_stats": user_stats
        }


def record_game_stats(
    telegram_id: int,
    game_id: str,
    score: Optional[int] = None,
    time_delta: int = 0
) -> Dict:
    """Запись результатов и игрового времени в user_game_stats и user_activity."""
    if not telegram_id or telegram_id <= 0 or not game_id:
        return {}
    clean_game_id = str(game_id).strip().lower()
    if clean_game_id not in ("2048", "tetris", "minesweeper"):
        return {}

    valid_time_delta = min(max(0, int(time_delta or 0)), 120)
    valid_score = None
    if score is not None:
        try:
            valid_score = max(0, min(int(score), 10_000_000))
        except (ValueError, TypeError):
            valid_score = None

    now_iso = datetime.now().isoformat()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if valid_score is not None:
            cursor.execute('''
                INSERT INTO user_game_stats (telegram_id, game_id, high_score, total_time_seconds, last_played)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(telegram_id, game_id) DO UPDATE SET
                    high_score = MAX(user_game_stats.high_score, excluded.high_score),
                    total_time_seconds = user_game_stats.total_time_seconds + excluded.total_time_seconds,
                    last_played = excluded.last_played
            ''', (telegram_id, clean_game_id, valid_score, valid_time_delta, now_iso))
        else:
            cursor.execute('''
                INSERT INTO user_game_stats (telegram_id, game_id, high_score, total_time_seconds, last_played)
                VALUES (?, ?, 0, ?, ?)
                ON CONFLICT(telegram_id, game_id) DO UPDATE SET
                    total_time_seconds = user_game_stats.total_time_seconds + excluded.total_time_seconds,
                    last_played = excluded.last_played
            ''', (telegram_id, clean_game_id, valid_time_delta, now_iso))

        if valid_time_delta > 0:
            cursor.execute('''
                UPDATE user_activity
                SET game_time_seconds = COALESCE(game_time_seconds, 0) + ?
                WHERE telegram_id = ?
            ''', (valid_time_delta, telegram_id))

        conn.commit()

        cursor.execute('''
            SELECT game_id, high_score, total_time_seconds, last_played
            FROM user_game_stats
            WHERE telegram_id = ? AND game_id = ?
        ''', (telegram_id, clean_game_id))
        row = cursor.fetchone()
        return dict(row) if row else {}


def get_user_game_stats(telegram_id: Optional[int] = None) -> Dict[str, Any]:
    """Получение статистики игр для пользователя и топа по каждой игре."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        user_stats = {}
        if telegram_id and telegram_id > 0:
            cursor.execute('''
                SELECT game_id, high_score, total_time_seconds, last_played
                FROM user_game_stats
                WHERE telegram_id = ?
            ''', (telegram_id,))
            rows = cursor.fetchall()
            user_stats = {row['game_id']: dict(row) for row in rows}

        leaderboards = {}
        now_iso = datetime.now().isoformat()
        for gid in ("2048", "tetris", "minesweeper"):
            cursor.execute('''
                SELECT g.telegram_id, g.high_score, g.total_time_seconds,
                       COALESCE(NULLIF(u.first_name, ''), NULLIF(u.username, ''), 'Игрок') as display_name,
                       u.photo_url, u.selected_group
                FROM user_game_stats g
                LEFT JOIN user_activity u ON g.telegram_id = u.telegram_id
                WHERE g.game_id = ? AND g.high_score > 0
                  AND COALESCE(u.leaderboard_opt_in, 1) = 1
                  AND g.telegram_id NOT IN (
                      SELECT telegram_id FROM banned_users
                      WHERE banned_until IS NULL OR banned_until > ?
                  )
                ORDER BY g.high_score DESC
                LIMIT 10
            ''', (gid, now_iso))
            leaderboards[gid] = [dict(r) for r in cursor.fetchall()]

        return {
            "my_stats": user_stats,
            "leaderboards": leaderboards
        }


def get_user_activity_history(limit: int = 100) -> List[Dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT telegram_id, username, first_name, photo_url, selected_group, last_action, ip_address, platform, first_seen, last_seen, visits_count, total_time_seconds, leaderboard_opt_in
            FROM user_activity
            ORDER BY last_seen DESC
            LIMIT ?
        ''', (limit,))
        return [dict(row) for row in cursor.fetchall()]


def record_hourly_request(telegram_id: Optional[int] = None) -> None:
    hour_key = datetime.now().strftime("%Y-%m-%d %H:00")
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO hourly_stats (hour_key, requests_count, unique_users)
                VALUES (?, 1, 1)
                ON CONFLICT(hour_key) DO UPDATE SET
                    requests_count = hourly_stats.requests_count + 1
            ''', (hour_key,))
            conn.commit()
    except Exception as e:
        logger.debug(f"Hourly stats record error: {e}")


def get_analytics_summary() -> Dict:
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Почасовая статистика за последние 24 часа
        cursor.execute('''
            SELECT hour_key, requests_count
            FROM hourly_stats
            ORDER BY hour_key DESC
            LIMIT 24
        ''')
        hourly_rows = [dict(row) for row in cursor.fetchall()]
        hourly_rows.reverse()

        # Топ групп по активности
        cursor.execute('''
            SELECT selected_group, COUNT(*) as user_count, SUM(visits_count) as total_visits
            FROM user_activity
            WHERE selected_group IS NOT NULL AND selected_group != ""
            GROUP BY selected_group
            ORDER BY total_visits DESC
            LIMIT 10
        ''')
        top_groups = [dict(row) for row in cursor.fetchall()]

        # Общие счетчики
        cursor.execute('SELECT COUNT(*) as total_users, COALESCE(SUM(visits_count), 0) as total_views FROM user_activity')
        totals_row = cursor.fetchone()
        total_users = totals_row['total_users'] if totals_row else 0
        total_sessions = totals_row['total_views'] if totals_row else 0

        # Сумма технических запросов к API за последние 24 часа
        cursor.execute('SELECT COALESCE(SUM(requests_count), 0) as total_reqs FROM hourly_stats')
        req_row = cursor.fetchone()
        total_api_requests = req_row['total_reqs'] if req_row else 0

        cursor.execute('SELECT COUNT(*) as banned_count FROM banned_users')
        banned_row = cursor.fetchone()
        banned_count = banned_row['banned_count'] if banned_row else 0

        cursor.execute('SELECT COUNT(*) as open_reports FROM client_bug_reports WHERE status = "open"')
        open_rep_row = cursor.fetchone()
        open_reports_count = open_rep_row['open_reports'] if open_rep_row else 0

        return {
            "total_users": total_users,
            "total_views": total_sessions,  # Совместимость с фронтендом
            "total_sessions": total_sessions,  # Четкое разделение: сессии / визиты
            "total_api_requests_24h": total_api_requests,  # Техническая метрика API-нагрузки
            "banned_count": banned_count,
            "open_reports_count": open_reports_count,
            "hourly_activity": hourly_rows,
            "top_groups": top_groups
        }


def save_bug_report(
    telegram_id: Optional[int],
    group_name: str,
    error_message: str,
    stack_trace: str = "",
    url: str = ""
) -> int:
    now_iso = datetime.now().isoformat()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO client_bug_reports (telegram_id, group_name, error_message, stack_trace, url, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, "open")
        ''', (telegram_id or 0, group_name or "", error_message, stack_trace or "", url or "", now_iso))
        conn.commit()
        return cursor.lastrowid


def get_bug_reports(status: str = "open", limit: int = 50) -> List[Dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if status:
            cursor.execute('''
                SELECT id, telegram_id, group_name, error_message, stack_trace, url, created_at, status
                FROM client_bug_reports
                WHERE status = ?
                ORDER BY id DESC
                LIMIT ?
            ''', (status, limit))
        else:
            cursor.execute('''
                SELECT id, telegram_id, group_name, error_message, stack_trace, url, created_at, status
                FROM client_bug_reports
                ORDER BY id DESC
                LIMIT ?
            ''', (limit,))
        return [dict(row) for row in cursor.fetchall()]


def resolve_bug_report(report_id: int, admin_id: int = 0) -> bool:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE client_bug_reports
            SET status = "resolved"
            WHERE id = ?
        ''', (report_id,))
        success = cursor.rowcount > 0
        if success:
            now_iso = datetime.now().isoformat()
            cursor.execute('''
                INSERT INTO admin_audit_logs (admin_id, target_id, action, reason, duration, created_at)
                VALUES (?, ?, "resolve_report", "Ошибка помечена решенной", "", ?)
            ''', (admin_id, report_id, now_iso))
        conn.commit()
        return success


init_db()
