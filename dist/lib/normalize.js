export function stripYearRange(title) {
    return title.replace(/\(\d{4}.*?\)/g, "").trim();
}
export function normalizeCanonicalTitle(raw) {
    return stripYearRange(raw)
        .replace(/\s+-\s+.*$/g, "")
        .replace(/\bw\/.*$/i, "")
        .replace(/\bwith .*$/i, "")
        .trim();
}
