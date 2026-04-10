import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { uploadDocuments } from "../api/documents";

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setFiles(Array.from(e.dataTransfer.files));
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files));
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      await uploadDocuments(files);
      navigate("/");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 32 }}>
      <h1>Upload Documents</h1>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => document.getElementById("file-input")?.click()}
        style={{
          border: "2px dashed #ccc", borderRadius: 8, padding: 40,
          textAlign: "center", cursor: "pointer", marginBottom: 16,
          background: files.length ? "#f0f9ff" : "transparent",
        }}
      >
        {files.length
          ? files.map((f) => <div key={f.name}>{f.name} ({(f.size / 1024).toFixed(1)} KB)</div>)
          : <p>Drag & drop files here, or click to select</p>
        }
        <input id="file-input" type="file" multiple hidden onChange={onFileChange}
          accept=".pdf,.txt,.docx" />
      </div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <button
        onClick={handleUpload}
        disabled={!files.length || uploading}
        style={{ padding: "10px 24px", background: "#2563eb", color: "#fff",
          border: "none", borderRadius: 6, cursor: "pointer", fontSize: 16 }}
      >
        {uploading ? "Uploading..." : "Upload & Process"}
      </button>
    </div>
  );
}