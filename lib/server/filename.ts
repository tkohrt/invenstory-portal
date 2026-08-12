import "server-only";
// Resolve the best download filename for a document so originals keep their true
// extension. Priority: the stored original filename → mime-type map → doc_kind.
const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/plain": "txt", "text/markdown": "md", "text/html": "html",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/wav": "wav", "audio/x-wav": "wav",
};
const KIND_EXT: Record<string, string> = { pdf: "pdf", docx: "docx", xlsx: "xlsx", note: "txt", web: "html", audio: "mp3" };

export interface FileDoc { title: string; original_name?: string | null; mime_type?: string | null; doc_kind?: string | null }

const safe = (s: string) => String(s).replace(/[^\w.\- ]+/g, "_").slice(0, 90);

export function downloadFilename(doc: FileDoc): string {
  if (doc.original_name && doc.original_name.trim()) return safe(doc.original_name.trim());
  const ext = (doc.mime_type && MIME_EXT[doc.mime_type]) || (doc.doc_kind && KIND_EXT[doc.doc_kind]) || "bin";
  const base = safe(doc.title);
  return base.toLowerCase().endsWith("." + ext) ? base : `${base}.${ext}`;
}
