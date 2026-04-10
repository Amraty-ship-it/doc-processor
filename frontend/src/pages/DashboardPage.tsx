import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listDocuments } from "../api/documents";
import type { Document, JobStatus } from "../types";

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: "#f59e0b", processing: "#3b82f6",
  completed: "#10b981", failed: "#ef4444", finalized: "#8b5cf6",
};

export default function DashboardPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const navigate = useNavigate();

  const fetchDocs = async () => {
    const res = await listDocuments({ page, page_size: 20, search, status, sort_by: sortBy, sort_dir: "desc" });
    setDocs(res.data.items);
    setTotal(res.data.total);
  };

  useEffect(() => { fetchDocs(); }, [page, search, status, sortBy]);

  // Auto-refresh while any doc is processing
  useEffect(() => {
    const hasActive = docs.some(d => d.status === "queued" || d.status === "processing");
    if (!hasActive) return;
    const t = setInterval(fetchDocs, 3000);
    return () => clearInterval(t);
  }, [docs]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1>Documents ({total})</h1>
        <button onClick={() => navigate("/upload")}
          style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + Upload
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <input placeholder="Search filename..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
          <option value="">All statuses</option>
          {["queued","processing","completed","failed","finalized"].map(s =>
            <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
          <option value="created_at">Date</option>
          <option value="original_filename">Name</option>
          <option value="file_size">Size</option>
        </select>
      </div>

      {/* Document list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {docs.map((doc) => (
          <div key={doc.id} onClick={() => navigate(`/documents/${doc.id}`)}
            style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 8,
              cursor: "pointer", background: "#fff", display: "flex",
              justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 500 }}>{doc.original_filename}</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                {(doc.file_size / 1024).toFixed(1)} KB · {new Date(doc.created_at).toLocaleString()}
              </div>
              {(doc.status === "queued" || doc.status === "processing") && (
                <div style={{ marginTop: 8, height: 4, background: "#e5e7eb", borderRadius: 2, width: 200 }}>
                  <div style={{ height: "100%", width: `${doc.progress}%`,
                    background: STATUS_COLORS[doc.status], borderRadius: 2, transition: "width 0.5s" }} />
                </div>
              )}
            </div>
            <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12,
              background: STATUS_COLORS[doc.status] + "20", color: STATUS_COLORS[doc.status],
              fontWeight: 500 }}>
              {doc.status}
            </span>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "center" }}>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
          style={{ padding: "6px 16px", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>Prev</button>
        <span style={{ padding: "6px 16px" }}>Page {page}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={docs.length < 20}
          style={{ padding: "6px 16px", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>Next</button>
      </div>
    </div>
  );
}