import asyncio
import logging
import multiprocessing
import os
import sys
import uvicorn
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(__file__))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def run_web():
    """Запуск веб-сервера FastAPI."""
    port = int(os.getenv("PORT", 8000))
    logger.info(f"Запуск веб-сервера на http://0.0.0.0:{port}")
    uvicorn.run("app:app", host="0.0.0.0", port=port, log_level="info")


def run_bot():
    """Запуск Telegram-бота."""
    from bot import create_bot_app

    bot_app = create_bot_app()
    if bot_app:
        logger.info("Запуск Telegram-бота...")
        bot_app.run_polling()
    else:
        logger.warning("Бот не запущен: проверьте BOT_TOKEN в файле .env")


if __name__ == "__main__":
    logger.info("Запуск веб-сервиса и Telegram-бота...")

    web_process = multiprocessing.Process(target=run_web, name="WebServer")
    web_process.start()

    try:
        run_bot()
    except KeyboardInterrupt:
        logger.info("Остановка процессов...")
    finally:
        web_process.terminate()
        web_process.join()
