export type JobStatus = "queued" | "processing" | "completed" | "failed" | "finalized";

export interface Document {
  id: string;
  filename: string;
  original_filename: string;
  file_size: number;
  file_type: string;
  status: JobStatus;
  progress: number;
  current_stage: string | null;
  extracted_data: Record<string, any> | null;
  reviewed_data: Record<string, any> | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  items: Document[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProgressEvent {
  event: string;
  progress: number;
  message: string;
  document_id: string;
}