FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml poetry.lock* ./
RUN pip install --no-cache-dir poetry \
    && poetry config virtualenvs.create false \
    && poetry install --only main --no-root --no-interaction --no-ansi

COPY . .

ENV HF_HOME=/root/.cache/huggingface

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
