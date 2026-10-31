FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PORT=10000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "yt-dlp[default]"

WORKDIR /app

COPY . .

EXPOSE 10000

# O servidor lê a variável PORT (Render/Railway/Fly) e escuta em 0.0.0.0.
CMD ["python", "servidor.py"]
