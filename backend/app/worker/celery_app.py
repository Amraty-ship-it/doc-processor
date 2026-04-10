from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "doc_processor",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,           # Acknowledge AFTER task completes (safer)
    worker_prefetch_multiplier=1,  # One task at a time per worker
)