// One way to write an EIN.
//
// The same funder arrives as "34-0714588" from one tool and "340714588" from
// another, and For Granted's own entry form stores digits. Three spellings of
// one identity produced duplicate rows on a client's page and, worse, made
// mergeOverlay miss a correction entirely — it compares base_id to a record id
// as raw strings, so a dash was enough to lose an approved verification.
//
// Pure and dependency-free so every layer can agree on it.
export function normalizeEin(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}
