import os
import sys
import asyncio
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from parser import parser

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="College Schedule API",
    description="API расписания занятий Колледжа телекоммуникаций",
    version="1.0.0",
)

# Разрешаем CORS для работы WebApp и сторонних клиентов
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "static")

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


async def background_sync_task():
    """Фоновая постоянная синхронизация с Google Таблицей раз в 30 секунд."""
    logger.info("Запущен фоновый процесс синхронизации (каждые 30 сек)")
    while True:
        await asyncio.sleep(30)
        try:
            data = parser.get_data(force_refresh=True)
            logger.info(f"Авто-синхронизация выполнена: {data['last_updated']}")
        except Exception as e:
            logger.warning(f"Ошибка авто-синхронизации: {e}")


@app.on_event("startup")
async def startup_event():
    """При старте загружаем или проверяем кэш расписания."""
    try:
        data = parser.get_data(force_refresh=True)
        logger.info(f"Расписание инициализировано: {data['groups_count']} групп")
    except Exception as e:
        logger.error(f"Ошибка инициализации расписания: {e}")
    # Запускаем постоянный фоновый опрос Google таблицы
    asyncio.create_task(background_sync_task())


@app.get("/")
async def root():
    """Отдача главного интерфейса расписания."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Schedule Web Service is running. Open /static/index.html"}


@app.get("/api/status")
async def get_status():
    """Текущий статус сервиса, дата обновления, чётность недели, звонки и перемены."""
    data = parser.get_data()
    return {
        "title": data.get("title", "Колледж телекоммуникаций"),
        "subtitle": data.get("subtitle", ""),
        "last_updated": data.get("last_updated", ""),
        "timestamp": data.get("timestamp", 0),
        "groups_count": data.get("groups_count", 0),
        "teachers_count": len(data.get("teachers", [])),
        "classrooms_count": len(data.get("classrooms", [])),
        "bell_times": data.get("bell_times", {}),
        "break_times": data.get("break_times", []),
        "week_info": data.get("week_info", {}),
        "day_dates": data.get("day_dates", {}),
    }


@app.get("/api/groups")
async def get_groups():
    """Список всех учебных групп с распределением по курсам."""
    data = parser.get_data()
    return {
        "groups": data.get("groups", []),
        "courses": ["1 курс", "2 курс", "3 курс", "4 курс", "Очно-заочное"],
    }


@app.get("/api/schedule")
async def get_schedule(group: str = Query(..., description="Название группы, например ИСП9-24А")):
    """Полное расписание для конкретной учебной группы."""
    data = parser.get_data()
    group_norm = group.strip()
    schedules = data.get("schedules", {})

    if group_norm not in schedules:
        # Попробуем регистронезависимый поиск
        found = None
        for g_name in schedules:
            if g_name.lower() == group_norm.lower():
                found = g_name
                break
        if found:
            group_norm = found
        else:
            raise HTTPException(status_code=404, detail=f"Группа '{group}' не найдена")

    return {
        "group": group_norm,
        "course": schedules[group_norm].get("course", ""),
        "section": schedules[group_norm].get("section", ""),
        "days": schedules[group_norm].get("days", {}),
        "bell_times": data.get("bell_times", {}),
        "break_times": data.get("break_times", []),
        "week_info": data.get("week_info", {}),
        "day_dates": data.get("day_dates", {}),
        "last_updated": data.get("last_updated", ""),
        "timestamp": data.get("timestamp", 0),
    }


@app.get("/api/teachers")
async def get_teachers():
    """Список всех преподавателей."""
    data = parser.get_data()
    return {"teachers": data.get("teachers", [])}


@app.get("/api/teacher-schedule")
async def get_teacher_schedule(teacher: str = Query(..., description="ФИО преподавателя")):
    """Расписание занятий для конкретного преподавателя."""
    data = parser.get_data()
    teacher_norm = teacher.strip()
    teacher_schedules = data.get("teacher_schedules", {})

    if teacher_norm not in teacher_schedules:
        # Поиск по подстроке
        matches = [t for t in teacher_schedules if teacher_norm.lower() in t.lower()]
        if len(matches) == 1:
            teacher_norm = matches[0]
        elif not matches:
            raise HTTPException(status_code=404, detail=f"Преподаватель '{teacher}' не найден")

    lessons = teacher_schedules.get(teacher_norm, [])
    # Сгруппируем по дням недели
    grouped_by_day = {}
    for item in lessons:
        d = item["day"]
        grouped_by_day.setdefault(d, []).append(item)

    # Сортируем пары внутри дней
    for d in grouped_by_day:
        grouped_by_day[d].sort(key=lambda x: x["pair_num"])

    return {
        "teacher": teacher_norm,
        "days": grouped_by_day,
        "last_updated": data.get("last_updated", ""),
    }


@app.get("/api/classrooms")
async def get_classrooms():
    """Список всех кабинетов и аудиторий."""
    data = parser.get_data()
    return {"classrooms": data.get("classrooms", [])}


@app.get("/api/classroom-schedule")
async def get_classroom_schedule(room: str = Query(..., description="Номер или название аудитории")):
    """Занятость конкретной аудитории по дням недели."""
    data = parser.get_data()
    room_norm = room.strip()
    classroom_schedules = data.get("classroom_schedules", {})

    if room_norm not in classroom_schedules:
        matches = [r for r in classroom_schedules if room_norm.lower() == r.lower()]
        if matches:
            room_norm = matches[0]
        else:
            raise HTTPException(status_code=404, detail=f"Аудитория '{room}' не найдена")

    lessons = classroom_schedules.get(room_norm, [])
    grouped_by_day = {}
    for item in lessons:
        d = item["day"]
        grouped_by_day.setdefault(d, []).append(item)

    for d in grouped_by_day:
        grouped_by_day[d].sort(key=lambda x: x["pair_num"])

    return {
        "classroom": room_norm,
        "days": grouped_by_day,
        "last_updated": data.get("last_updated", ""),
    }


@app.post("/api/refresh")
async def refresh_schedule():
    """Принудительное обновление расписания из Google Sheets."""
    try:
        updated = parser.get_data(force_refresh=True)
        return {
            "status": "success",
            "message": "Расписание успешно обновлено из Google Таблицы",
            "last_updated": updated["last_updated"],
            "groups_count": updated["groups_count"],
        }
    except Exception as e:
        logger.error(f"Ошибка при обновлении расписания: {e}")
        raise HTTPException(status_code=500, detail=f"Не удалось обновить: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
