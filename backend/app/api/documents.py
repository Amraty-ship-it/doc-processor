import os
import json
import csv
import io
import uuid
import asyncio
import aiofiles
import redis.asyncio as aioredis
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from app.core.database import get_db
from app.core.config import settings
from app.models.document import Document, JobStatus
from app.schemas.document import DocumentResponse, DocumentListResponse, UpdateReviewedData
from app.worker.tasks import process_document

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_TYPES = {"application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}

@router.post("/upload", response_model=list[DocumentResponse])
async def upload_documents(files: list[UploadFile] = File(...), db: AsyncSession = Depends(get_db)):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    created = []

    for file in files:
        if file.size and file.size > settings.MAX_FILE_SIZE:
            raise HTTPException(400, f"File {file.filename} exceeds 10MB limit")

        doc_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1]
        saved_name = f"{doc_id}{ext}"
        file_path = os.path.join(settings.UPLOAD_DIR, saved_name)

        async with aiofiles.open(file_path, "wb") as f:
            content = await file.read()
            await f.write(content)

        doc = Document(
            id=doc_id,
            filename=saved_name,
            original_filename=file.filename,
            file_path=file_path,
            file_size=len(content),
            file_type=file.content_type or "application/octet-stream",
            status=JobStatus.QUEUED,
        )
        db.add(doc)
        await db.flush()

        # Dispatch Celery task — NOT in the request-response cycle
        task = process_document.delay(doc_id, file_path, file.filename, len(content), file.content_type or "")
        doc.celery_task_id = task.id
        created.append(doc)

    await db.commit()
    for doc in created:
        await db.refresh(doc)
    return created

@router.get("", response_model=DocumentListResponse)
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query(None),
    search: str = Query(None),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    query = select(Document)

    if status:
        query = query.where(Document.status == status)
    if search:
        query = query.where(
            or_(Document.original_filename.ilike(f"%{search}%"))
        )

    sort_col = getattr(Document, sort_by, Document.created_at)
    query = query.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())

    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    docs = result.scalars().all()

    return {"items": docs, "total": total, "page": page, "page_size": page_size}

@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc

@router.get("/{doc_id}/progress")
async def stream_progress(doc_id: str):
    """Server-Sent Events endpoint for real-time progress."""
    async def event_generator():
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        pubsub = r.pubsub()
        await pubsub.subscribe(f"doc_progress:{doc_id}")

        try:
            # Send current status first
            current = await r.get(f"doc_status:{doc_id}")
            if current:
                yield f"data: {current}\n\n"

            async for message in pubsub.listen():
                if message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                    data = json.loads(message["data"])
                    if data.get("event") in ("job_completed", "job_failed"):
                        break
        finally:
            await pubsub.unsubscribe()
            await r.aclose()

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@router.patch("/{doc_id}/review", response_model=DocumentResponse)
async def update_review(doc_id: str, payload: UpdateReviewedData, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    doc.reviewed_data = payload.reviewed_data
    await db.commit()
    await db.refresh(doc)
    return doc

@router.post("/{doc_id}/finalize", response_model=DocumentResponse)
async def finalize_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.status not in (JobStatus.COMPLETED, JobStatus.FAILED):
        raise HTTPException(400, "Document must be completed before finalizing")
    doc.status = JobStatus.FINALIZED
    await db.commit()
    await db.refresh(doc)
    return doc

@router.post("/{doc_id}/retry", response_model=DocumentResponse)
async def retry_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.status != JobStatus.FAILED:
        raise HTTPException(400, "Only failed documents can be retried")
    doc.status = JobStatus.QUEUED
    doc.progress = 0
    doc.error_message = None
    doc.retry_count += 1
    task = process_document.delay(doc_id, doc.file_path, doc.original_filename, doc.file_size, doc.file_type)
    doc.celery_task_id = task.id
    await db.commit()
    await db.refresh(doc)
    return doc

@router.get("/{doc_id}/export")
async def export_document(doc_id: str, format: str = Query("json"), db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.status != JobStatus.FINALIZED:
        raise HTTPException(400, "Only finalized documents can be exported")

    data = doc.reviewed_data or doc.extracted_data or {}

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["field", "value"])
        for key, value in data.items():
            writer.writerow([key, json.dumps(value) if isinstance(value, (dict, list)) else value])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={doc.original_filename}.csv"}
        )

    return JSONResponse(content={"document_id": doc_id, "filename": doc.original_filename, "data": data})