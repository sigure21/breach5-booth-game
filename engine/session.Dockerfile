FROM python:3.13.9-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --system --gid 10001 sessionlab \
    && useradd --system --uid 10001 --gid sessionlab --no-create-home --shell /usr/sbin/nologin sessionlab

WORKDIR /app
COPY engine/session-requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY --chown=sessionlab:sessionlab engine/session_engine.py ./session_engine.py

USER sessionlab
EXPOSE 4400
CMD ["gunicorn", "--bind", "0.0.0.0:4400", "--workers", "1", "--threads", "2", "--timeout", "10", "--access-logfile", "-", "--error-logfile", "-", "session_engine:app"]
