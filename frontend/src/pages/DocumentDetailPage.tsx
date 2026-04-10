import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getDocument, updateReview, finalizeDocument, retryDocument,
  exportDocument, subscribeToProgress } from "../api/documents";
import type { Document } from "../types";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Document | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [editing, setEditing] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!id) return;
    const res = await getDocument(id);
    setDoc(res.data);
    setEditData(res.data.reviewed_data || res.data.extracted_data || {});
  };

  useEffect(() => {
    load();
  }, [id]);

  // Subscribe to SSE progress events
  useEffect(() => {
    if (!id || !doc) return;
    if (doc.status !== "queued" && doc.status !== "processing") return;

    const unsub = subscribeToProgress(id, (e) => {
      setEvents(prev => [...prev.slice(-9), `${e.event}: ${e.message} (${e.progress}%)`]);
      if (e.event === "job_completed" || e.event === "job_failed") {
        load(); // Refresh doc after completion
      }
    });
    return unsub;
  }, [id, doc?.status]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await updateReview(id, editData);
      setDoc(res.data);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!id) return;
    const res = await finalizeDocument(id);
    setDoc(res.data);
  };

  const handleRetry = async () => {
    if (!id) return;
    const res = await retryDocument(id);
    setDoc(res.data);
    setEvents([]);
  };

  if (!doc) return <div style={{ padding: 32 }}>Loading...</div>;

  const displayData = doc.reviewed_data || doc.extracted_data;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <button onClick={() => navigate("/")} style={{ marginBottom: 16, background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 }}>
        ← Back to dashboard
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{doc.original_filename}</h1>
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            {(doc.file_size / 1024).toFixed(1)} KB · {doc.file_type} · Uploaded {new Date(doc.created_at).toLocaleString()}
          </p>
        </div>
        <span style={{ padding: "6px 14px", borderRadius: 999, background: "#e0f2fe", color: "#0369a1", fontWeight: 600 }}>
          {doc.status}
        </span>
      </div>

      {/* Progress bar */}
      {(doc.status === "queued" || doc.status === "processing") && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
            <span>{doc.current_stage || "Waiting..."}</span>
            <span>{doc.progress}%</span>
          </div>
          <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4 }}>
            <div style={{ height: "100%", width: `${doc.progress}%`, background: "#3b82f6", borderRadius: 4, transition: "width 0.5s" }} />
          </div>
          {events.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280", fontFamily: "monospace",
              background: "#f8f9fa", padding: 10, borderRadius: 6, maxHeight: 120, overflowY: "auto" }}>
              {events.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Error + retry */}
      {doc.status === "failed" && (
        <div style={{ marginTop: 16, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6 }}>
          <p style={{ color: "#dc2626", margin: 0 }}>Error: {doc.error_message}</p>
          <button onClick={handleRetry} style={{ marginTop: 8, padding: "6px 16px", background: "#dc2626",
            color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Retry (attempt {doc.retry_count + 1})
          </button>
        </div>
      )}

      {/* Extracted / reviewed data */}
      {displayData && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Extracted Data</h2>
            <div style={{ display: "flex", gap: 8 }}>
              {doc.status === "completed" && !editing && (
                <button onClick={() => setEditing(true)}
                  style={{ padding: "6px 16px", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>
                  Edit
                </button>
              )}
              {editing && (
                <>
                  <button onClick={handleSave} disabled={saving}
                    style={{ padding: "6px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => setEditing(false)}
                    style={{ padding: "6px 16px", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Render each field */}
          {Object.entries(editing ? editData : displayData).map(([key, value]) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {key.replace(/_/g, " ")}
              </label>
              {editing && typeof value !== "object" ? (
                <input
                  value={String(editData[key] ?? "")}
                  onChange={(e) => setEditData(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 4, fontSize: 14, boxSizing: "border-box" }}
                />
              ) : (
                <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 4, fontSize: 14, fontFamily: typeof value === "object" ? "monospace" : "inherit" }}>
                  {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
                </div>
              )}
            </div>
          ))}

          {/* Finalize */}
          {doc.status === "completed" && (
            <button onClick={handleFinalize}
              style={{ marginTop: 16, padding: "10px 24px", background: "#10b981", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 15 }}>
              Finalize Document
            </button>
          )}

          {/* Export */}
          {doc.status === "finalized" && (
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <a href={exportDocument(doc.id, "json")} download
                style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", borderRadius: 6, textDecoration: "none", fontSize: 14 }}>
                Export JSON
              </a>
              <a href={exportDocument(doc.id, "csv")} download
                style={{ padding: "8px 20px", background: "#059669", color: "#fff", borderRadius: 6, textDecoration: "none", fontSize: 14 }}>
                Export CSV
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}