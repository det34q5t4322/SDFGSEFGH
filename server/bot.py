import json
import logging
import os
import sys
from datetime import datetime
from typing import Dict, Optional

from dotenv import load_dotenv
from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

# Загружаем настройки из .env
load_dotenv()

# Импортируем наш парсер расписания
sys.path.append(os.path.dirname(__file__))
from parser import parser, get_academic_week_info, BELL_TIMES, BREAK_TIMES

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
    """Сохранение базы пользователей."""
    try:
        with open(USERS_DB_FILE, "w", encoding="utf-8") as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Ошибка сохранения пользователей: {e}")


def get_user_group(user_id: int) -> Optional[str]:
    users = load_users()
    return users.get(str(user_id), {}).get("group")


def set_user_group(user_id: int, username: str, group: str) -> None:
    users = load_users()
    users[str(user_id)] = {
        "group": group,
        "username": username or "",
        "updated_at": datetime.now().isoformat(),
    }
    save_users(users)


def get_current_week_parity() -> str:
    """Определение текущей недели: num (числитель/I) или den (знаменатель/II)."""
    now = datetime.now()
    year = now.year if now.month >= 8 else now.year - 1
    sept_first = datetime(year, 9, 1)
    diff_days = (now - sept_first).days
    week_num = (diff_days // 7) + 1
    return "num" if (week_num % 2 == 1) else "den"


def build_main_keyboard(web_app_url: Optional[str] = None) -> ReplyKeyboardMarkup:
    """Минималистичная главная клавиатура бота."""
    keyboard = []
    if web_app_url:
        keyboard.append([KeyboardButton("🚀 Открыть приложение", web_app=WebAppInfo(url=web_app_url))])
    keyboard.append([KeyboardButton("📅 Сегодня"), KeyboardButton("📆 Завтра")])
    keyboard.append([KeyboardButton("🗓 Вся неделя"), KeyboardButton("⚙️ Сменить группу")])
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


async def app_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Команда /app — открытие веб-приложения."""
    if not WEB_APP_URL:
        await update.message.reply_text(
            "⚠️ Веб-приложение еще настраивается. Используйте текстовые кнопки меню.",
            reply_markup=build_main_keyboard(),
        )
        return
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚀 Открыть интерактивное расписание", web_app=WebAppInfo(url=WEB_APP_URL))]
    ])
    await update.message.reply_text(
        "📱 Нажмите кнопку ниже, чтобы открыть расписание:",
        reply_markup=kb,
    )


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Минималистичное меню /start."""
    user = update.effective_user
    user_id = user.id
    current_group = get_user_group(user_id)

    data = parser.get_data()
    week_info = data.get("week_info", {})
    parity_str = week_info.get("parity_name", "Числитель")
    week_num = week_info.get("week_number", 1)

    if current_group:
        greeting = (
            f"👋 **Расписание Колледжа телекоммуникаций**\n\n"
            f"🎯 Ваша группа: **{current_group}**\n"
            f"⚡ Сейчас: **{parity_str}** ({week_num}-я неделя)\n"
        )
    else:
        greeting = (
            f"👋 Привет, {user.first_name}!\n\n"
            f"Я бот с расписанием **Колледжа телекоммуникаций**.\n"
            f"⚡ Сейчас: **{parity_str}** ({week_num}-я неделя)\n\n"
            f"⚠️ Пожалуйста, выберите свою группу:"
        )

    inline_keyboard = []
    if WEB_APP_URL:
        inline_keyboard.append([
            InlineKeyboardButton("🚀 Открыть приложение", web_app=WebAppInfo(url=WEB_APP_URL))
        ])
    if not current_group:
        inline_keyboard.append([
            InlineKeyboardButton("👥 Выбрать группу", callback_data="select_group_courses")
        ])

    reply_markup = build_main_keyboard(WEB_APP_URL)

    await update.message.reply_text(
        greeting,
        parse_mode="Markdown",
        reply_markup=reply_markup,
    )

    if inline_keyboard:
        await update.message.reply_text(
            "Быстрый переход:",
            reply_markup=InlineKeyboardMarkup(inline_keyboard),
        )


async def show_courses_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Показывает список курсов для выбора группы."""
    query = update.callback_query
    if query:
        await query.answer()

    courses = ["1 курс", "2 курс", "3 курс", "4 курс", "Очно-заочное"]
    keyboard = [
        [InlineKeyboardButton(f"🎓 {c}", callback_data=f"course_{c}")] for c in courses
    ]

    text = "Выберите ваш курс или отделение:"
    if query:
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.effective_message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


async def show_groups_for_course(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Показывает группы конкретного курса."""
    query = update.callback_query
    await query.answer()

    course_name = query.data.replace("course_", "")
    data = parser.get_data()
    all_groups = data.get("groups", [])

    course_groups = [g["name"] for g in all_groups if g.get("course") == course_name]

    if not course_groups:
        await query.edit_message_text(f"Группы для '{course_name}' не найдены.")
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

    await query.edit_message_text(
        f"Выберите вашу группу ({course_name}):",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def set_group_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Сохранение выбранной группы."""
    query = update.callback_query
    await query.answer()

    group_name = query.data.replace("setgrp_", "")
    user = update.effective_user
    set_user_group(user.id, user.username, group_name)

    await query.edit_message_text(
        f"✅ Отлично! Группа **{group_name}** сохранена.\n\n"
        f"Теперь ты можешь смотреть расписание кнопками «Сегодня», «Завтра» и «Вся неделя».",
        parse_mode="Markdown",
    )


from datetime import datetime, timedelta

def get_break_description(after_pair: int, before_pair: int) -> str:
    """Возвращает текстовое описание перемены между парами."""
    if after_pair == 1 and before_pair == 2:
        return "☕ *Маленькая перемена:* 10 мин (09:35 - 09:45)"
    elif after_pair == 2 and before_pair == 3:
        return "🥪 *Большая перемена:* 30 мин (11:20 - 11:50)"
    elif after_pair == 3 and before_pair == 4:
        return "🥪 *Большая перемена:* 30 мин (13:25 - 13:55)"
    elif after_pair == 4 and before_pair == 5:
        return "☕ *Маленькая перемена:* 10 мин (15:30 - 15:40)"
    elif after_pair == 5 and before_pair == 6:
        return "☕ *Маленькая перемена:* 10 мин (17:15 - 17:25)"
    elif before_pair > after_pair + 1:
        # Окно между парами
        p_prev = BELL_TIMES.get(after_pair, {})
        p_next = BELL_TIMES.get(before_pair, {})
        return f"⏱️ *Окно / Свободное время:* ({p_prev.get('end', '')} - {p_next.get('start', '')})"
    return "☕ *Перемена*"


NUM_EMOJIS = {1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣", 5: "5️⃣", 6: "6️⃣"}

def format_day_schedule(group_name: str, day_name: str, target_date: Optional[datetime] = None) -> str:
    """Форматирование расписания одного дня в читаемый, компактный вид без визуального шума."""
    data = parser.get_data()
    sched = data.get("schedules", {}).get(group_name)

    if not sched:
        return f"Расписание для группы {group_name} не найдено."

    day_schedule = sched.get("days", {}).get(day_name, [])
    date_str = data.get("day_dates", {}).get(day_name, "")
    
    # Расчет точной недели
    if target_date is None and data.get("week_info"):
        week_info = data["week_info"]
    else:
        week_info = get_academic_week_info(target_date)

    current_parity = week_info["parity"]
    parity_str = week_info["parity_name"]

    date_part = f", {date_str}" if date_str else ""
    header = f"📅 **{day_name}**{date_part} • {parity_str}\n"
    header += f"👥 Группа: **{group_name}**\n"
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
        header += "⚠️ *На этот день действуют замены/отмены*\n"

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
            meta_parts.append(f"Ауд. {aud}")
        if teacher:
            meta_parts.append(teacher)
        meta_str = "📍 " + " • ".join(meta_parts) if meta_parts else ""

        if is_canc:
            c_subj = lesson.get("cancelled_subject") or subj
            c_teacher = lesson.get("cancelled_teacher") or teacher
            t_info = f" ({c_teacher})" if c_teacher else ""
            card = f"{num_icon} `{p_time}` • ❌ *Отменена*\n"
            card += f"<s>{c_subj}{t_info}</s>"
        elif is_rep:
            badge = " • 🔄 *Замена*"
            if is_dist:
                badge += " (Дистант)"
            card = f"{num_icon} `{p_time}`{badge}\n"
            card += f"📖 **{subj}**\n"
            if meta_str:
                card += f"{meta_str}\n"
            c_subj = lesson.get("cancelled_subject", "")
            c_teacher = lesson.get("cancelled_teacher", "")
            if c_subj:
                t_str = f" ({c_teacher})" if c_teacher else ""
                card += f"↳ _Вместо: {c_subj}{t_str}_"
        else:
            badge = " (Дистант)" if is_dist else ""
            card = f"{num_icon} `{p_time}`{badge}\n"
            card += f"📖 **{subj}**"
            if meta_str:
                card += f"\n{meta_str}"

        cards.append(card.strip())

    return header + "\n\n".join(cards)


async def send_schedule_for_day(update: Update, context: ContextTypes.DEFAULT_TYPE, offset_days: int) -> None:
    """Отправка расписания на сегодня (offset=0) или завтра (offset=1) с точной чётностью недели."""
    user_id = update.effective_user.id
    group_name = get_user_group(user_id)

    if not group_name:
        await update.message.reply_text(
            "⚠️ Сначала выберите вашу группу кнопкой «Моя группа»!",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("👥 Выбрать группу", callback_data="select_group_courses")]
            ]),
        )
        return

    now = datetime.now()
    target_date = now + timedelta(days=offset_days)
    target_weekday = target_date.weekday()

    if target_weekday == 6:  # Воскресенье
        if offset_days == 0:
            await update.message.reply_text("🌴 Сегодня воскресенье — выходной день!")
            return
        else:
            # Завтра воскресенье — покажем расписание на понедельник
            monday_date = target_date + timedelta(days=1)
            monday_name = DAY_MAP[monday_date.weekday()]
            text = "🌴 Завтра воскресенье — выходной!\n\n📋 *Расписание на понедельник:*\n\n"
            text += format_day_schedule(group_name, monday_name, target_date=monday_date)
            await update.message.reply_text(text, parse_mode="Markdown")
            return

    day_name = DAY_MAP[target_weekday]
    text = format_day_schedule(group_name, day_name, target_date=target_date)
    reply_markup = None
    if WEB_APP_URL:
        reply_markup = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚀 Открыть интерактивное расписание", web_app=WebAppInfo(url=WEB_APP_URL))]
        ])
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=reply_markup)


async def send_week_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Отправка расписания на всю неделю с учётом текущего числителя/знаменателя."""
    user_id = update.effective_user.id
    group_name = get_user_group(user_id)

    if not group_name:
        await update.message.reply_text("⚠️ Сначала выберите вашу группу!")
        return

    days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]
    now = datetime.now()
    for d in days:
        text = format_day_schedule(group_name, d, target_date=now)
        await update.message.reply_text(text, parse_mode="Markdown")


async def text_message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка текстовых кнопок."""
    text = update.message.text.strip()

    if "Сегодня" in text:
        await send_schedule_for_day(update, context, offset_days=0)
    elif "Завтра" in text:
        await send_schedule_for_day(update, context, offset_days=1)
    elif "неделя" in text.lower():
        await send_week_schedule(update, context)
    elif "групп" in text.lower():
        await show_courses_menu(update, context)
    elif "приложен" in text.lower() or "расписан" in text.lower():
        await app_command(update, context)
    else:
        # Проверим, может это название группы
        data = parser.get_data()
        group_match = None
        for g in data.get("groups", []):
            if g["name"].lower() == text.lower():
                group_match = g["name"]
                break

        if group_match:
            user = update.effective_user
            set_user_group(user.id, user.username, group_match)
            await update.message.reply_text(
                f"✅ Группа **{group_match}** сохранена!",
                parse_mode="Markdown",
            )
        else:
            await update.message.reply_text(
                "Используйте кнопки меню или отправьте команду /start",
                reply_markup=build_main_keyboard(WEB_APP_URL),
            )


async def post_init(application) -> None:
    """Регистрация команд в официальном меню Telegram."""
    try:
        await application.bot.set_my_commands([
            BotCommand("app", "🚀 Открыть приложение"),
            BotCommand("today", "📅 Расписание на сегодня"),
            BotCommand("tomorrow", "📆 Расписание на завтра"),
            BotCommand("week", "🗓 Расписание на неделю"),
            BotCommand("group", "⚙️ Сменить группу"),
            BotCommand("start", "🔄 Главное меню"),
        ])
        logger.info("Команды меню бота успешно зарегистрированы!")
    except Exception as e:
        logger.warning(f"Не удалось установить команды меню: {e}")


def create_bot_app():
    """Сборка и настройка приложения Telegram-бота с учетом прокси/Cloudflare."""
    if not BOT_TOKEN:
        logger.warning("BOT_TOKEN не задан в .env! Бот не может запуститься.")
        return None

    builder = ApplicationBuilder().token(BOT_TOKEN).post_init(post_init)

    # 1. Обход блокировок через Cloudflare Worker Reverse Proxy
    if TELEGRAM_API_URL:
        logger.info(f"Используем кастомный Telegram API URL (Cloudflare Worker): {TELEGRAM_API_URL}")
        builder = builder.base_url(TELEGRAM_API_URL)

    # 2. Обход блокировок через SOCKS5 / HTTP прокси
    if PROXY_URL:
        logger.info(f"Используем прокси: {PROXY_URL}")
        builder = builder.proxy(PROXY_URL).get_updates_proxy(PROXY_URL)

    app = builder.build()

    # Регистрация обработчиков
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("app", app_command))
    app.add_handler(CommandHandler("today", lambda u, c: send_schedule_for_day(u, c, 0)))
    app.add_handler(CommandHandler("tomorrow", lambda u, c: send_schedule_for_day(u, c, 1)))
    app.add_handler(CommandHandler("week", send_week_schedule))
    app.add_handler(CommandHandler("group", show_courses_menu))

    app.add_handler(CallbackQueryHandler(show_courses_menu, pattern="^select_group_courses$"))
    app.add_handler(CallbackQueryHandler(show_groups_for_course, pattern="^course_"))
    app.add_handler(CallbackQueryHandler(set_group_callback, pattern="^setgrp_"))

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message_handler))

    return app


if __name__ == "__main__":
    app = create_bot_app()
    if app:
        logger.info("Запуск Telegram-бота...")
        app.run_polling()
    else:
        print("Пожалуйста, укажите BOT_TOKEN в файле .env")
