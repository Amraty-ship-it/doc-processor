import time
import json
import redis
from celery import Task
from app.worker.celery_app import celery_app
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.document import Document, JobStatus
from sqlalchemy import select
import asyncio

redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

def publish_event(doc_id: str, event: str, progress: int, message: str = ""):
    """Publish a progress event to Redis Pub/Sub channel."""
    payload = json.dumps({
        "event": event,
        "progress": progress,
        "message": message,
        "document_id": doc_id,
    })
    redis_client.publish(f"doc_progress:{doc_id}", payload)
    # Also store latest status in Redis for polling fallback
    redis_client.setex(f"doc_status:{doc_id}", 300, payload)

def update_doc_sync(doc_id: str, **kwargs):
    """Synchronous DB update for use inside Celery tasks."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    engine = create_engine(settings.SYNC_DATABASE_URL)
    with Session(engine) as session:
        doc = session.get(Document, doc_id)
        if doc:
            for k, v in kwargs.items():
                setattr(doc, k, v)
            session.commit()

def extract_text_from_file(file_path: str, file_type: str) -> str:
    """Extract raw text from uploaded file."""
    try:
        if "pdf" in file_type.lower():
            import PyPDF2
            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                return " ".join(page.extract_text() or "" for page in reader.pages)
        elif "word" in file_type.lower() or file_path.endswith(".docx"):
            from docx import Document as DocxDocument
            doc = DocxDocument(file_path)
            return " ".join(p.text for p in doc.paragraphs)
        else:
            with open(file_path, "r", errors="ignore") as f:
                return f.read()
    except Exception:
        return ""  # Fallback: empty string, processing continues

def derive_structured_fields(text: str, filename: str, file_size: int, file_type: str) -> dict:
    """Simulate structured field extraction — replace with AI/OCR as needed."""
    words = text.lower().split() if text else []
    
    # Simple keyword extraction (top 5 most frequent meaningful words)
    stopwords = {"the","a","an","is","in","of","to","and","for","with","this","that","it","be","as"}
    freq = {}
    for w in words:
        clean = w.strip(".,!?;:\"'()")
        if clean and clean not in stopwords and len(clean) > 3:
            freq[clean] = freq.get(clean, 0) + 1
    keywords = sorted(freq, key=freq.get, reverse=True)[:5]

    # Derive a category from filename + content hints
    name_lower = filename.lower()
    if any(k in name_lower for k in ["invoice","receipt","bill"]):
        category = "Financial"
    elif any(k in name_lower for k in ["report","analysis","study"]):
        category = "Report"
    elif any(k in name_lower for k in ["contract","agreement","terms"]):
        category = "Legal"
    else:
        category = "General"

    # Generate a mock summary
    summary = f"Document '{filename}' ({file_type}, {file_size} bytes). "
    if text:
        summary += f"Contains approximately {len(words)} words. "
    summary += f"Classified as {category}."

    return {
        "title": filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").title(),
        "category": category,
        "summary": summary,
        "keywords": keywords,
        "word_count": len(words),
        "file_metadata": {
            "filename": filename,
            "file_type": file_type,
            "file_size_bytes": file_size,
        },
        "processing_status": "extracted",
    }

@celery_app.task(bind=True, max_retries=3, name="process_document")
def process_document(self, doc_id: str, file_path: str, filename: str, file_size: int, file_type: str):
    """
    Main document processing task.
    Publishes progress events at each stage via Redis Pub/Sub.
    """
    try:
        # Stage 1: Job started
        publish_event(doc_id, "job_started", 5, "Job picked up by worker")
        update_doc_sync(doc_id, status=JobStatus.PROCESSING, progress=5, current_stage="job_started")
        time.sleep(0.5)

        # Stage 2: Parsing started
        publish_event(doc_id, "document_parsing_started", 20, "Parsing document...")
        update_doc_sync(doc_id, progress=20, current_stage="parsing")
        time.sleep(1)

        # Extract raw text
        raw_text = extract_text_from_file(file_path, file_type)

        # Stage 3: Parsing completed
        publish_event(doc_id, "document_parsing_completed", 45, "Parsing complete")
        update_doc_sync(doc_id, progress=45, current_stage="parsing_done")
        time.sleep(0.5)

        # Stage 4: Extraction started
        publish_event(doc_id, "field_extraction_started", 60, "Extracting structured fields...")
        update_doc_sync(doc_id, progress=60, current_stage="extracting")
        time.sleep(1)

        # Run field extraction
        extracted = derive_structured_fields(raw_text, filename, file_size, file_type)

        # Stage 5: Extraction completed
        publish_event(doc_id, "field_extraction_completed", 85, "Fields extracted")
        update_doc_sync(doc_id, progress=85, current_stage="extraction_done", extracted_data=extracted)
        time.sleep(0.5)

        # Stage 6: Storing result
        publish_event(doc_id, "job_completed", 100, "Processing complete!")
        update_doc_sync(
            doc_id,
            status=JobStatus.COMPLETED,
            progress=100,
            current_stage="completed",
            extracted_data=extracted,
        )

    except Exception as exc:
        error_msg = str(exc)
        publish_event(doc_id, "job_failed", 0, f"Failed: {error_msg}")
        update_doc_sync(doc_id, status=JobStatus.FAILED, error_message=error_msg, current_stage="failed")
        # Retry with exponential backoff
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)