const ISSUE_PATTERNS: Array<{ label: string; regex: RegExp; severity: "high" | "medium" | "low" }> = [
  { label: "Headstock repair", regex: /headstock repair|repaired headstock/i, severity: "high" },
  { label: "Crack", regex: /\bcrack\b/i, severity: "high" },
  { label: "Break", regex: /\bbreak\b/i, severity: "high" },
  { label: "Truss rod issue", regex: /truss rod issue|truss rod doesn.?t work|frozen truss rod/i, severity: "high" },
  { label: "Refret / major fret wear", regex: /refret|needs frets|significant fret wear|major fret wear/i, severity: "medium" },
  { label: "Neck issue", regex: /neck issue|warped neck|twisted neck/i, severity: "high" },
  { label: "Routing / extra holes", regex: /routing|routed|extra holes/i, severity: "medium" },
  { label: "Electronics issue", regex: /intermittent|non.?functional|doesn.?t work|scratchy pot/i, severity: "medium" },
  { label: "Missing parts", regex: /missing part|missing knob|missing hardware/i, severity: "medium" },
  { label: "Smoke smell", regex: /smoke smell|cigarette smell/i, severity: "low" }
];

export function scanListingIssues(text: string | null | undefined): string[] {
  if (!text) return [];

  const matches: string[] = [];

  for (const rule of ISSUE_PATTERNS) {
    if (rule.regex.test(text)) {
      matches.push(`${rule.label} (${rule.severity})`);
    }
  }

  return matches;
}