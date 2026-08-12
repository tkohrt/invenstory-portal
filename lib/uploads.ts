// Single source of truth for accepted upload file types (client + server).
// Excludes images and slide decks for now — those get emailed to For Granted.
export const EXT_TO_KIND: Record<string, string> = {
  pdf: "pdf",
  docx: "docx", doc: "docx",
  txt: "note", md: "note", csv: "note",
  rtf: "rtf",
  html: "web",
  xlsx: "xlsx", xls: "xlsx",
  mp3: "audio", m4a: "audio", wav: "audio",
};
export const ACCEPTED_EXTENSIONS = Object.keys(EXT_TO_KIND);
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map(e => "." + e).join(",");
export const ACCEPTED_LABEL =
  "PDF, Word (.docx/.doc), text (.txt/.md/.rtf), CSV, HTML, Excel (.xlsx/.xls), and audio (.mp3/.m4a/.wav)";
export const SUPPORT_EMAIL = "info@forgranted.com";

export const extOf = (name: string): string => (name.split(".").pop() ?? "").toLowerCase();
export const isAccepted = (name: string): boolean => ACCEPTED_EXTENSIONS.includes(extOf(name));
