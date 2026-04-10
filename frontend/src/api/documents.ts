import axios from "axios";
import type { Document, DocumentListResponse } from "../types";

const api = axios.create({ baseURL: "http://localhost:8000/api" });

export const uploadDocuments = (files: File[]) => {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return api.post<Document[]>("/documents/upload", form);
};

export const listDocuments = (params: {
  page?: number; page_size?: number; status?: string;
  search?: string; sort_by?: string; sort_dir?: string;
}) => api.get<DocumentListResponse>("/documents", { params });

export const getDocument = (id: string) =>
  api.get<Document>(`/documents/${id}`);

export const updateReview = (id: string, reviewed_data: Record<string, any>) =>
  api.patch<Document>(`/documents/${id}/review`, { reviewed_data });

export const finalizeDocument = (id: string) =>
  api.post<Document>(`/documents/${id}/finalize`);

export const retryDocument = (id: string) =>
  api.post<Document>(`/documents/${id}/retry`);

export const exportDocument = (id: string, format: "json" | "csv") =>
  `http://localhost:8000/api/documents/${id}/export?format=${format}`;

export const subscribeToProgress = (
  docId: string,
  onEvent: (e: { event: string; progress: number; message: string }) => void
) => {
  const es = new EventSource(`http://localhost:8000/api/documents/${docId}/progress`);
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch {}
  };
  return () => es.close();
};