from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime
from app.models.document import JobStatus

class DocumentBase(BaseModel):
    filename: str
    original_filename: str
    file_size: int
    file_type: str

class DocumentResponse(DocumentBase):
    id: str
    status: JobStatus
    progress: int
    current_stage: Optional[str]
    extracted_data: Optional[dict]
    reviewed_data: Optional[dict]
    error_message: Optional[str]
    retry_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
    total: int
    page: int
    page_size: int

class UpdateReviewedData(BaseModel):
    reviewed_data: dict[str, Any]

class ExportFormat(str):
    JSON = "json"
    CSV = "csv"