FROM python:3.11-slim

WORKDIR /app

# Установка системных утилит
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Копируем зависимости
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем проект
COPY . .

EXPOSE 8000

# Запуск веб-сервера (FastAPI)
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
