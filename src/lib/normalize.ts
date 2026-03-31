export function stripYearRange(title: string): string {
  return title.replace(/\(\d{4}.*?\)/g, "").trim();
}

export function normalizeCanonicalTitle(raw: string): string {
  return stripYearRange(raw)
    .replace(/\s+-\s+.*$/g, "")
    .replace(/\bw\/.*$/i, "")
    .replace(/\bwith .*$/i, "")
    .trim();
}