import { BrowserRouter, Routes, Route } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import UploadPage from "./pages/UploadPage";
import DocumentDetailPage from "./pages/DocumentDetailPage";

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: "100vh", background: "#f9fafb" }}>
        <nav style={{ background: "#1e293b", padding: "12px 24px", color: "#fff", fontSize: 18, fontWeight: 600 }}>
          Doc Processor
        </nav>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
