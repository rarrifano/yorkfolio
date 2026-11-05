# YorkFolio — stdlib-only Python app: no pip install needed.
FROM docker.io/library/python:3.14-slim

ARG VERSION=dev
LABEL org.opencontainers.image.title="YorkFolio" \
      org.opencontainers.image.description="Self-hosted, holder-style portfolio tracker for B3 investors" \
      org.opencontainers.image.source="https://github.com/rarrifano/yorkfolio" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=America/Sao_Paulo \
    YORKFOLIO_DATA=/data

# tzdata: "today" (proventos 12m, IR due dates, monthly history) must follow local time, not UTC
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1000 --create-home --shell /usr/sbin/nologin yorkfolio \
 && mkdir -p /data && chown yorkfolio:yorkfolio /data

WORKDIR /app
COPY LICENSE run.py ./
COPY yorkfolio ./yorkfolio

USER yorkfolio
VOLUME /data
EXPOSE 8000
CMD ["python3", "run.py", "serve", "--host", "0.0.0.0", "--port", "8000"]
