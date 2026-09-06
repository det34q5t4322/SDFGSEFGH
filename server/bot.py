import hashlib
import hmac
import html
import json
import logging
import os
import re
import sys
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    MenuButtonWebApp,
    ReplyKeyboardMarkup,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    Defaults,
    MessageHandler,
    filters,
)
from telegram.request import HTTPXRequest

# Загружаем настройки из .env
load_dotenv()

# Импортируем наш парсер расписания
sys.path.append(os.path.dirname(__file__))
from parser import parser, get_academic_week_info, BELL_TIMES, BREAK_TIMES, get_moscow_now

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# Конфигурация бота
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEB_APP_URL = os.getenv("WEB_APP_URL", "")  # URL вашего сайта, например https://myschedule.ru
TELEGRAM_API_URL = os.getenv("TELEGRAM_API_URL", "")  # Прокси Cloudflare Worker
PROXY_URL = os.getenv("TELEGRAM_PROXY", "")  # SOCKS5 или HTTP прокси

USERS_DB_FILE = os.path.join(os.path.dirname(__file__), "bot_users.json")

DAY_MAP = {
    0: "Понедельник",
    1: "Вторник",
    2: "Среда",
    3: "Четверг",
    4: "Пятница",
    5: "Суббота",
    6: "Воскресенье",
}


def load_users() -> Dict[str, dict]:
    """Загрузка базы данных пользователей (сохраненные группы)."""
    if os.path.exists(USERS_DB_FILE):
        try:
            with open(USERS_DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Ошибка загрузки пользователей: {e}")
    return {}


def save_users(users: Dict[str, dict]) -> None:
    """Сохранение базы пользователей атомарно через временный файл."""
    try:
        tmp_file = f"{USERS_DB_FILE}.tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(users, f, ensure_ascii=False)
        os.replace(tmp_file, USERS_DB_FILE)
    except Exception as e:
        logger.error(f"Ошибка сохранения пользователей: {e}")


def html_esc(text: Any) -> str:
    """Безопасное экранирование HTML для сообщений Telegram."""
    if text is None:
        return ""
    return html.escape(str(text))


def verify_telegram_init_data(init_data: str, bot_token: str) -> Optional[dict]:
    """Верификация подписи данных Telegram WebApp через HMAC-SHA256."""
    if not init_data or not bot_token:
        return None
    try:
        parsed = urllib.parse.parse_qsl(init_data, keep_blank_values=True)
        data_dict = dict(parsed)
        received_hash = data_dict.pop("hash", None)
        if not received_hash:
            return None
        check_items = [f"{k}={v}" for k, v in sorted(data_dict.items())]
        data_check_string = "\n".join(check_items)
        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
        if hmac.compare_digest(calculated_hash, received_hash):
            user_json = data_dict.get("user")
            if user_json:
                return json.loads(user_json)
            return data_dict
        return None
    except Exception as e:
        logger.warning(f"Telegram initData verification error: {e}")
        return None


DEFAULT_GROUP = "ИСС9-25"
DIARY_1C_URL = "https://online-obr-e5cloud-02-gpt-msk.1c.ru/library.html?db_name=moskva_kolledzh_telekommunikatcii_mtusi"


def get_user_group(user_id: int) -> str:
    """Получение сохраненной группы пользователя. По умолчанию ИСС9-25."""
    users = load_users()
    saved = users.get(str(user_id), {}).get("group")
    return saved if saved else DEFAULT_GROUP


def get_webapp_url(group: Optional[str] = None) -> Optional[str]:
    """Генерация ссылки на WebApp с автоподстановкой группы (если указана) и сбросом кэша."""
    if not WEB_APP_URL:
        return None
    import urllib.parse
    base = WEB_APP_URL.rstrip("/") + "/"
    sep = "&" if "?" in base else "?"
    if group:
        return f"{base}{sep}v=20260906_1&group={urllib.parse.quote(group)}"
    return f"{base}{sep}v=20260906_1"


def set_user_group(user_id: int, username: str, group: str) -> None:
    """Сохранение группы пользователя с валидацией входных данных."""
    if not isinstance(user_id, int) or user_id <= 0:
        raise ValueError("user_id должен быть положительным целым числом")
    if not group or not isinstance(group, str):
        raise ValueError("group не может быть пустым")
    clean_group = group.strip()
    if len(clean_group) > 50:
        raise ValueError("Длина названия группы превышает допустимый лимит (50 символов)")
    if not re.match(r"^[\w\s\-\.\(\)]+$", clean_group, re.UNICODE):
        raise ValueError("Название группы содержит недопустимые символы")

    users = load_users()
    users[str(user_id)] = {
        "group": clean_group,
        "username": username or "",
        "updated_at": get_moscow_now().isoformat(),
    }
    save_users(users)


def get_current_week_parity() -> str:
    """Определение текущей недели: num (числитель/I) или den (знаменатель/II) по академическому календарю МСК."""
    now = get_moscow_now()
    return get_academic_week_info(now)["parity"]


def build_main_keyboard(group: str = DEFAULT_GROUP) -> ReplyKeyboardMarkup:
    """Нижняя панель Telegram (для быстрого доступа)."""
    keyboard = []
    wa_url = get_webapp_url(group)
    if wa_url:
        keyboard.append([KeyboardButton("🚀 Открыть приложение", web_app=WebAppInfo(url=wa_url))])
    keyboard.append([KeyboardButton("📅 Сегодня"), KeyboardButton("📆 Завтра")])
    keyboard.append([KeyboardButton("🗓 Вся неделя"), KeyboardButton("⚙️ Сменить группу")])
    keyboard.append([KeyboardButton("💀🚨 Английский"), KeyboardButton("📚 Дневник 1С")])
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def build_schedule_keyboard(offset_days: int = 0, group: str = DEFAULT_GROUP) -> InlineKeyboardMarkup:
    """Инлайн-кнопки под расписанием для мгновенного переключения дней на месте."""
    buttons = []
    wa_url = get_webapp_url(group)
    if wa_url:
        buttons.append([
            InlineKeyboardButton("🚀 Открыть интерактивное приложение", web_app=WebAppInfo(url=wa_url))
        ])

    nav_row = [
        InlineKeyboardButton("◀ Вчера", callback_data=f"day_{offset_days - 1}"),
        InlineKeyboardButton("📅 Сегодня", callback_data="day_0"),
        InlineKeyboardButton("Завтра ▶", callback_data=f"day_{offset_days + 1}"),
    ]
    buttons.append(nav_row)

    actions = [
        InlineKeyboardButton("🗓 Вся неделя", callback_data="view_week"),
        InlineKeyboardButton("⚙️ Сменить группу", callback_data="select_group_courses"),
    ]
    buttons.append(actions)
    buttons.append([
        InlineKeyboardButton("💀🚨 До английского", callback_data="view_alarm"),
        InlineKeyboardButton("📚 Электронный дневник 1С", url=DIARY_1C_URL),
    ])

    return InlineKeyboardMarkup(buttons)


async def send_or_edit(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str, reply_markup=None) -> None:
    """
    Редактирует текущее сообщение в чате при нажатии инлайн-кнопок,
    или отправляет новое сообщение при вводе команды / нажатии кнопок меню.
    Использует HTML разметку с автоматическим fallback на plain text при ошибках парсинга.
    """
    query = update.callback_query
    if query:
        try:
            await query.answer()
            await query.edit_message_text(text=text, parse_mode="HTML", reply_markup=reply_markup)
            return
        except Exception as e:
            if "Message is not modified" in str(e):
                return
            logger.warning(f"Ошибка edit_message_text (HTML) в callback: {e}, retry plain text")
            try:
                plain_text = re.sub(r'<[^>]+>', '', text)
                await query.edit_message_text(text=plain_text, parse_mode=None, reply_markup=reply_markup)
                return
            except Exception as e2:
                if "Message is not modified" not in str(e2):
                    logger.error(f"Повторная ошибка edit_message_text: {e2}")

    chat_id = update.effective_chat.id

    # При получении команды или текстового сообщения ВСЕГДА отправляем свежее сообщение пользователю
    try:
        msg = await context.bot.send_message(
            chat_id=chat_id,
            text=text,
            parse_mode="HTML",
            reply_markup=reply_markup,
            disable_notification=True,
        )
    except Exception as e:
        logger.warning(f"Ошибка send_message (HTML): {e}, retry plain text")
        plain_text = re.sub(r'<[^>]+>', '', text)
        msg = await context.bot.send_message(
            chat_id=chat_id,
            text=plain_text,
            parse_mode=None,
            reply_markup=reply_markup,
            disable_notification=True,
        )
    context.user_data["last_bot_msg_id"] = msg.message_id


async def app_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Команда /app — открытие веб-приложения."""
    if not WEB_APP_URL:
        await send_or_edit(
            update, context,
            "⚠️ Веб-приложение еще настраивается. Используйте текстовые кнопки меню.",
            reply_markup=build_schedule_keyboard(0),
        )
        return
    wa_url = get_webapp_url(get_user_group(update.effective_user.id)) or WEB_APP_URL
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚀 Открыть интерактивное расписание", web_app=WebAppInfo(url=wa_url))]
    ])
    await send_or_edit(
        update, context,
        "📱 Нажмите кнопку ниже, чтобы открыть интерактивное расписание:",
        reply_markup=kb,
    )


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Приветственное меню /start: открывает клавиатуру и расписание на сегодня."""
    user = update.effective_user
    user_id = user.id
    current_group = get_user_group(user_id)
    context.user_data["last_bot_msg_id"] = None

    if not current_group:
        await show_courses_menu(update, context)
        return

    welcome_text = (
        f"👋 Привет, <b>{html_esc(user.first_name or 'студент')}</b>!\n"
        f"Я бот с актуальным расписанием Колледжа телекоммуникаций МТУСИ.\n\n"
        f"👥 Твоя группа: <b>{html_esc(current_group)}</b>"
    )

    if update.message:
        await update.message.reply_text(
            welcome_text,
            parse_mode="HTML",
            reply_markup=build_main_keyboard(current_group),
            disable_notification=True,
        )
    await send_schedule_for_day(update, context, offset_days=0)


async def show_courses_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Показывает список курсов для выбора группы в том же сообщении."""
    courses = ["1 курс", "2 курс", "3 курс", "4 курс", "Очно-заочное"]
    keyboard = [
        [InlineKeyboardButton(f"🎓 {c}", callback_data=f"course_{c}")] for c in courses
    ]

    user_id = update.effective_user.id
    current_group = get_user_group(user_id)
    if current_group:
        keyboard.append([InlineKeyboardButton("⬅ Назад к расписанию", callback_data="day_0")])

    text = "👥 <b>Выберите ваш курс или отделение:</b>"
    await send_or_edit(update, context, text, reply_markup=InlineKeyboardMarkup(keyboard))


async def show_groups_for_course(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Показывает группы конкретного курса в том же сообщении."""
    query = update.callback_query
    course_name = query.data.replace("course_", "")
    data = parser.get_data()
    all_groups = data.get("groups", [])

    course_groups = [g["name"] for g in all_groups if g.get("course") == course_name]

    if not course_groups:
        await send_or_edit(update, context, f"Группы для '{html_esc(course_name)}' не найдены.", None)
        return

    # Разбиваем кнопки по 3 в ряд
    keyboard = []
    row = []
    for g in course_groups:
        row.append(InlineKeyboardButton(g, callback_data=f"setgrp_{g}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)

    keyboard.append([InlineKeyboardButton("⬅ Назад к курсам", callback_data="select_group_courses")])

    text = f"👥 <b>Выберите вашу группу ({html_esc(course_name)}):</b>"
    await send_or_edit(update, context, text, reply_markup=InlineKeyboardMarkup(keyboard))


async def set_group_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Сохранение группы и моментальное отображение расписания в том же сообщении."""
    query = update.callback_query
    group_name = query.data.replace("setgrp_", "")
    user = update.effective_user
    set_user_group(user.id, user.username, group_name)
    await send_schedule_for_day(update, context, offset_days=0)


def get_break_description(after_pair: int, before_pair: int) -> str:
    """Возвращает текстовое описание перемены между парами."""
    if after_pair == 1 and before_pair == 2:
        return "☕ <b>Маленькая перемена:</b> 10 мин (09:35 - 09:45)"
    elif after_pair == 2 and before_pair == 3:
        return "🥪 <b>Большая перемена:</b> 30 мин (11:20 - 11:50)"
    elif after_pair == 3 and before_pair == 4:
        return "🥪 <b>Большая перемена:</b> 30 мин (13:25 - 13:55)"
    elif after_pair == 4 and before_pair == 5:
        return "☕ <b>Маленькая перемена:</b> 10 мин (15:30 - 15:40)"
    elif after_pair == 5 and before_pair == 6:
        return "☕ <b>Маленькая перемена:</b> 10 мин (17:15 - 17:25)"
    elif before_pair > after_pair + 1:
        # Окно между парами
        p_prev = BELL_TIMES.get(after_pair, {})
        p_next = BELL_TIMES.get(before_pair, {})
        return f"⏱️ <b>Окно / Свободное время:</b> ({html_esc(p_prev.get('end', ''))} - {html_esc(p_next.get('start', ''))})"
    return "☕ <b>Перемена</b>"


NUM_EMOJIS = {1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣", 5: "5️⃣", 6: "6️⃣"}

def format_day_schedule(group_name: str, day_name: str, target_date: Optional[datetime] = None) -> str:
    """Форматирование расписания одного дня в читаемый, компактный HTML вид без визуального шума."""
    try:
        data = parser.get_data()
    except Exception as e:
        logger.error(f"Ошибка получения расписания: {e}")
        data = parser.data or {}

    sched = data.get("schedules", {}).get(group_name)

    if not sched:
        return f"Расписание для группы {html_esc(group_name)} не найдено."

    day_schedule = sched.get("days", {}).get(day_name, [])
    date_str = data.get("day_dates", {}).get(day_name, "")
    
    # Расчет точной недели
    if target_date is None and data.get("week_info"):
        week_info = data["week_info"]
    else:
        week_info = get_academic_week_info(target_date)

    current_parity = week_info["parity"]
    parity_str = week_info["parity_name"]

    date_part = f", {html_esc(date_str)}" if date_str else ""
    header = f"📅 <b>{html_esc(day_name)}</b>{date_part} • {html_esc(parity_str)}\n"
    header += f"👥 Группа: <b>{html_esc(group_name)}</b>\n"
    if data.get("stale"):
        header += "⚠️ <i>Показана сохранённая копия расписания</i>\n"
    header += "━━━━━━━━━━━━━━━━━━━━\n"

    active_pairs = []
    has_replacements = False

    for p in day_schedule:
        if p.get("is_empty"):
            continue

        lesson = p.get("both") or (p.get("numerator") if current_parity == "num" else p.get("denominator"))
        if lesson and (lesson.get("subject") or lesson.get("is_cancelled")):
            active_pairs.append({
                "pair_num": p["pair_num"],
                "time": p["time"],
                "lesson": lesson,
            })
            if lesson.get("is_replacement") or lesson.get("is_cancelled"):
                has_replacements = True

    if has_replacements:
        header += "⚠️ <i>На этот день действуют замены/отмены</i>\n"

    header += "\n"

    if not active_pairs:
        return header + "🌴 В этот день занятий нет! Свободный день."

    cards = []
    for item in active_pairs:
        p_num = item["pair_num"]
        p_time = item["time"]
        lesson = item["lesson"]

        num_icon = NUM_EMOJIS.get(p_num, f"{p_num}️⃣")

        subj = lesson.get("subject", "Занятие")
        teacher = lesson.get("teacher", "")
        aud = lesson.get("classroom", "")

        is_rep = lesson.get("is_replacement", False)
        is_canc = lesson.get("is_cancelled", False)
        is_dist = lesson.get("is_distant", False)

        meta_parts = []
        if aud:
            meta_parts.append(f"Ауд. {html_esc(aud)}")
        if teacher:
            meta_parts.append(html_esc(teacher))
        meta_str = "📍 " + " • ".join(meta_parts) if meta_parts else ""

        if is_canc:
            c_subj = lesson.get("cancelled_subject") or subj
            c_teacher = lesson.get("cancelled_teacher") or teacher
            t_info = f" ({html_esc(c_teacher)})" if c_teacher else ""
            card = f"{num_icon} <code>{html_esc(p_time)}</code> • ❌ <i>Отменена</i>\n"
            card += f"— {html_esc(c_subj)}{t_info}"
        elif is_rep:
            badge = " • 🔄 <i>Замена</i>"
            if is_dist:
                badge += " (Дистант)"
            card = f"{num_icon} <code>{html_esc(p_time)}</code>{badge}\n"
            card += f"📖 <b>{html_esc(subj)}</b>\n"
            if meta_str:
                card += f"{meta_str}\n"
            c_subj = lesson.get("cancelled_subject", "")
            c_teacher = lesson.get("cancelled_teacher", "")
            if c_subj:
                t_str = f" ({html_esc(c_teacher)})" if c_teacher else ""
                card += f"↳ <i>Вместо: {html_esc(c_subj)}{t_str}</i>"
        else:
            badge = " (Дистант)" if is_dist else ""
            card = f"{num_icon} <code>{html_esc(p_time)}</code>{badge}\n"
            card += f"📖 <b>{html_esc(subj)}</b>"
            if meta_str:
                card += f"\n{meta_str}"

        cards.append(card.strip())

    return header + "\n\n".join(cards)


async def send_schedule_for_day(update: Update, context: ContextTypes.DEFAULT_TYPE, offset_days: int = 0) -> None:
    """Отображение расписания дня в одном редактируемом сообщении."""
    user_id = update.effective_user.id
    group_name = get_user_group(user_id)

    if not group_name:
        await show_courses_menu(update, context)
        return

    now = get_moscow_now()
    target_date = now + timedelta(days=offset_days)
    target_weekday = target_date.weekday()

    if target_weekday == 6:  # Воскресенье
        if offset_days == 0:
            text = "🌴 <b>Сегодня воскресенье — выходной день!</b>\n\nОтличного отдыха перед парами! ☀️"
            await send_or_edit(update, context, text, reply_markup=build_schedule_keyboard(offset_days))
            return
        else:
            # Завтра воскресенье -> переключаем на понедельник
            target_date += timedelta(days=1)
            target_weekday = 0
            offset_days += 1

    day_name = DAY_MAP[target_weekday]
    text = format_day_schedule(group_name, day_name, target_date=target_date)
    await send_or_edit(update, context, text, reply_markup=build_schedule_keyboard(offset_days, group=group_name))


def build_week_keyboard(group: str = DEFAULT_GROUP) -> InlineKeyboardMarkup:
    """Инлайн-кнопки дней недели для быстрого переключения в одном сообщении."""
    buttons = []
    wa_url = get_webapp_url(group)
    if wa_url:
        buttons.append([
            InlineKeyboardButton("🚀 Открыть приложение (Mini App)", web_app=WebAppInfo(url=wa_url))
        ])

    row1 = [
        InlineKeyboardButton("Пн", callback_data="day_dow_0"),
        InlineKeyboardButton("Вт", callback_data="day_dow_1"),
        InlineKeyboardButton("Ср", callback_data="day_dow_2"),
    ]
    row2 = [
        InlineKeyboardButton("Чт", callback_data="day_dow_3"),
        InlineKeyboardButton("Пт", callback_data="day_dow_4"),
        InlineKeyboardButton("Сб", callback_data="day_dow_5"),
    ]
    buttons.append(row1)
    buttons.append(row2)
    buttons.append([
        InlineKeyboardButton("📅 К сегодняшнему дню", callback_data="day_0"),
        InlineKeyboardButton("⚙️ Сменить группу", callback_data="select_group_courses"),
    ])
    buttons.append([
        InlineKeyboardButton("📚 Электронный дневник 1С", url=DIARY_1C_URL)
    ])
    return InlineKeyboardMarkup(buttons)


async def send_week_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обзор недели в одном сообщении с кнопками перехода на любой день без спама."""
    user_id = update.effective_user.id
    group_name = get_user_group(user_id)

    if not group_name:
        await show_courses_menu(update, context)
        return

    data = parser.get_data()
    week_info = data.get("week_info", {})
    parity_str = week_info.get("parity_name", "Числитель")
    week_num = week_info.get("week_number", 1)

    text = (
        f"🗓 <b>Расписание на неделю</b>\n"
        f"👥 Группа: <b>{html_esc(group_name)}</b>\n"
        f"⚡ Неделя: <b>{html_esc(parity_str)}</b> ({week_num}-я)\n"
        f"━━━━━━━━━━━━━━━━━━━━\n\n"
        f"Нажмите на день недели ниже, чтобы сразу открыть его расписание прямо здесь:"
    )

    await send_or_edit(update, context, text, reply_markup=build_week_keyboard(group=group_name))


async def day_offset_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик листания дней (Вчера / Сегодня / Завтра)."""
    query = update.callback_query
    offset = int(query.data.replace("day_", ""))
    await send_schedule_for_day(update, context, offset_days=offset)


async def day_dow_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик перехода на конкретный день недели из меню недели."""
    query = update.callback_query
    target_dow = int(query.data.replace("day_dow_", ""))
    now = get_moscow_now()
    offset = target_dow - now.weekday()
    await send_schedule_for_day(update, context, offset_days=offset)


async def text_message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка текстовых сообщений и команд в одном сообщении."""
    text = update.message.text.strip()

    if "Сегодня" in text:
        await send_schedule_for_day(update, context, offset_days=0)
    elif "Завтра" in text:
        await send_schedule_for_day(update, context, offset_days=1)
    elif "неделя" in text.lower():
        await send_week_schedule(update, context)
    elif "групп" in text.lower():
        await show_courses_menu(update, context)
    elif any(kw in text.lower() for kw in ["английск", "тревог", "alarm", "💀", "🚨", "до англ"]):
        await alarm_command(update, context)
    elif "дневник" in text.lower() or "1с" in text.lower():
        await diary_command(update, context)
    elif "приложен" in text.lower() or "расписан" in text.lower():
        await app_command(update, context)
    else:
        # Проверяем введенное название группы
        data = parser.get_data()
        groups = data.get("groups", [])
        group_match = next((g["name"] for g in groups if g["name"].lower() == text.lower()), None)

        if group_match:
            user = update.effective_user
            set_user_group(user.id, user.username, group_match)
            await send_schedule_for_day(update, context, offset_days=0)
        else:
            await send_or_edit(
                update, context,
                "Используйте кнопки меню для навигации по расписанию:",
                reply_markup=build_schedule_keyboard(0),
            )


async def alarm_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """💀🚨 Сигнал тревоги — обратный отсчёт до ближайшего английского."""
    user = update.effective_user
    group_name = get_user_group(user.id) if user else DEFAULT_GROUP

    alarm = parser.get_upcoming_alarm(group_name, pattern=r"(англ|иностр)")

    if not alarm.get("found"):
        text = (
            "💀🚨 <b>СИГНАЛ ТРЕВОГИ: АНГЛИЙСКИЙ</b>\n"
            f"👥 Группа: <b>{html_esc(group_name)}</b>\n\n"
            "❌ В расписании группы пар иностранного языка не найдено.\n"
            "Возможно, расписание на следующую неделю ещё не опубликовано."
        )
    else:
        d = alarm["days_left"]
        h = alarm["hours_left"]
        m = alarm["minutes_left"]
        s = alarm["seconds_left_mod"]

        countdown_str = ""
        if d > 0:
            countdown_str += f"{d} дн. "
        countdown_str += f"{h:02d}:{m:02d}:{s:02d}"

        going_label = " ⚡ ИДЁТ ПРЯМО СЕЙЧАС!" if alarm.get("is_going_now") else ""

        text = (
            "💀🚨 <b>СИГНАЛ ТРЕВОГИ: АНГЛИЙСКИЙ</b>\n"
            f"👥 Группа: <b>{html_esc(group_name)}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📅 Дата: <b>{html_esc(alarm['display_date'])}</b>\n"
            f"⏰ Пара: <b>{html_esc(str(alarm['pair_num']))} пара ({html_esc(alarm['time'])})</b>\n"
            f"📚 Предмет: {html_esc(alarm['subject'])}\n"
            f"👨‍🏫 Преподаватель: {html_esc(alarm.get('teacher') or 'Не указан')}\n"
            f"🏫 Аудитория: {html_esc(('ауд. ' + alarm['classroom']) if alarm.get('classroom') else 'Не указана')}\n\n"
            f"⏳ До начала: <b>{html_esc(countdown_str)}</b>{going_label}\n"
            f"🕐 МСК сейчас: {html_esc(str(alarm['now_msk']))}"
        )

    wa_url = get_webapp_url(group_name)
    buttons = []
    if wa_url:
        buttons.append([InlineKeyboardButton("💀🚨 Открыть тревогу в приложении", web_app=WebAppInfo(url=wa_url))])
    buttons.append([
        InlineKeyboardButton("🔄 Обновить", callback_data="view_alarm"),
        InlineKeyboardButton("📅 Сегодня", callback_data="day_0"),
    ])
    keyboard = InlineKeyboardMarkup(buttons) if buttons else None

    await send_or_edit(update, context, text, reply_markup=keyboard)


async def alarm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Callback для инлайн-кнопки view_alarm."""
    await alarm_command(update, context)


async def diary_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Прямой переход в электронный дневник 1С:Колледж."""
    text = (
        "📚 <b>Электронный дневник 1С:Колледж</b>\n"
        "Московский колледж телекоммуникаций МТУСИ\n\n"
        "Нажмите на кнопку ниже или перейдите по прямой ссылке для входа в личный кабинет студента:\n\n"
        f"🔗 <a href=\"{DIARY_1C_URL}\">Вход в Дневник 1С (прямой портал)</a>\n\n"
        "💡 <b>Если в приложении Telegram белый экран:</b>\n"
        "Портал 1С защищён DDoS-Guard и требует открытия в обычном браузере. "
        "Нажмите на <b>три точки (⋮)</b> вверху справа экрана Telegram и выберите <b>«Открыть в браузере»</b> (Chrome / Safari / Яндекс)."
    )
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📚 Открыть дневник 1С", url=DIARY_1C_URL)]
    ])
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.message.reply_text(text, parse_mode="HTML", reply_markup=keyboard, disable_notification=True)
    elif update.message:
        await update.message.reply_text(text, parse_mode="HTML", reply_markup=keyboard, disable_notification=True)


async def support_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Команда /support — отправка гифки службы поддержки."""
    anim_path = os.path.join(os.path.dirname(__file__), "..", "static", "support_animation.mp4")
    chat_id = update.effective_chat.id
    if os.path.exists(anim_path):
        try:
            with open(anim_path, "rb") as f:
                await context.bot.send_animation(
                    chat_id=chat_id,
                    animation=f,
                    caption="🎧 <b>Служба поддержки</b>\nМы получили Ваше обращение и внимательно его изучаем!",
                    parse_mode="HTML",
                    disable_notification=True,
                )
                return
        except Exception as e:
            logger.warning(f"Ошибка отправки анимации поддержки: {e}")
    await send_or_edit(update, context, "🎧 Служба поддержки всегда на связи!")


async def post_init(application) -> None:
    """Регистрация команд в официальном меню Telegram и кнопки WebApp."""
    try:
        await application.bot.set_my_commands([
            BotCommand("app", "🚀 Открыть приложение"),
            BotCommand("today", "📅 Расписание на сегодня"),
            BotCommand("tomorrow", "📆 Расписание на завтра"),
            BotCommand("week", "🗓 Расписание на неделю"),
            BotCommand("alarm", "💀🚨 До английского"),
            BotCommand("group", "⚙️ Сменить группу"),
            BotCommand("diary", "📚 Дневник 1С"),
            BotCommand("support", "🎧 Служба поддержки"),
            BotCommand("start", "🔄 Главное меню"),
        ])
        logger.info("Команды меню бота успешно зарегистрированы!")

        if WEB_APP_URL:
            wa_menu_url = WEB_APP_URL.rstrip("/") + "/?v=20260906_1"
            await application.bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(text="Расписание", web_app=WebAppInfo(url=wa_menu_url))
            )
            logger.info(f"Кнопка WebApp 'Расписание' ({wa_menu_url}) в меню чата успешно установлена!")
    except Exception as e:
        logger.warning(f"Не удалось установить команды меню или кнопку WebApp: {e}")


def create_bot_app():
    """Сборка и настройка приложения Telegram-бота."""
    if not BOT_TOKEN:
        logger.warning("BOT_TOKEN не задан в .env! Бот не может запуститься.")
        return None

    request = HTTPXRequest(
        connect_timeout=20.0,
        read_timeout=30.0,
        write_timeout=20.0,
        pool_timeout=10.0,
    )
    get_updates_request = HTTPXRequest(
        connect_timeout=20.0,
        read_timeout=35.0,
        write_timeout=20.0,
        pool_timeout=10.0,
    )

    builder = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .request(request)
        .get_updates_request(get_updates_request)
        .post_init(post_init)
    )
    builder = builder.defaults(Defaults(disable_notification=True))

    if TELEGRAM_API_URL:
        logger.info(f"Используем кастомный Telegram API URL (Cloudflare Worker): {TELEGRAM_API_URL}")
        builder = builder.base_url(TELEGRAM_API_URL)

    if PROXY_URL:
        logger.info(f"Используем прокси: {PROXY_URL}")
        builder = builder.proxy(PROXY_URL).get_updates_proxy(PROXY_URL)

    app = builder.build()

    # Регистрация обработчиков команд
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("app", app_command))
    app.add_handler(CommandHandler("today", lambda u, c: send_schedule_for_day(u, c, 0)))
    app.add_handler(CommandHandler("tomorrow", lambda u, c: send_schedule_for_day(u, c, 1)))
    app.add_handler(CommandHandler("week", send_week_schedule))
    app.add_handler(CommandHandler(["alarm", "english"], alarm_command))
    app.add_handler(CommandHandler("group", show_courses_menu))
    app.add_handler(CommandHandler(["diary", "dnevnik"], diary_command))
    app.add_handler(CommandHandler(["support", "help_me"], support_command))

    # Регистрация callback-обработчиков (редактирование на месте)
    app.add_handler(CallbackQueryHandler(show_courses_menu, pattern="^select_group_courses$"))
    app.add_handler(CallbackQueryHandler(show_groups_for_course, pattern="^course_"))
    app.add_handler(CallbackQueryHandler(set_group_callback, pattern="^setgrp_"))
    app.add_handler(CallbackQueryHandler(send_week_schedule, pattern="^view_week$"))
    app.add_handler(CallbackQueryHandler(alarm_callback, pattern="^view_alarm$"))
    app.add_handler(CallbackQueryHandler(day_offset_callback, pattern=r"^day_(-?\d+)$"))
    app.add_handler(CallbackQueryHandler(day_dow_callback, pattern=r"^day_dow_(\d+)$"))

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message_handler))

    return app


if __name__ == "__main__":
    app = create_bot_app()
    if app:
        logger.info("Запуск Telegram-бота...")
        app.run_polling()
    else:
        print("Пожалуйста, укажите BOT_TOKEN в файле .env")
