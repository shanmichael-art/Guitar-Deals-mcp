import Anthropic from "@anthropic-ai/sdk";

export interface GuitarCheckResult {
  isComplete: boolean;
  reason: string;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.MCP_API_KEY });
  return client;
}

export async function isCompleteGuitar(
  title: string,
  description: string | null
): Promise<GuitarCheckResult> {
  const prompt = `You are helping a guitar dealer filter Reverb listings.
Given a listing title and description, determine whether this is a COMPLETE, PLAYABLE guitar or not.

Mark isComplete FALSE if any of these are true:
- Body only (no neck)
- Neck only (no body)
- Pickup set, hardware lot, pickguard, or other parts-only listing
- Explicitly a "parts guitar" or "parts lot"
- An unassembled or partially assembled build (e.g. neck not attached, visible neck/body gaps, neck shimming required to fit)
- Described as a project requiring major assembly work before it can be played

Mark isComplete TRUE for:
- Complete, fully assembled guitars — even with cosmetic flaws, minor missing accessories (whammy bar, strap button, case), or electronics needing minor repair
- Partscaster or custom builds that are fully assembled and playable
- Guitars needing setup or fret work but are otherwise complete

Title: ${title}
Description: ${description?.slice(0, 800) ?? "(no description)"}

Respond with JSON only, no markdown, no explanation outside the JSON:
{"isComplete": true, "reason": "one sentence"}
or
{"isComplete": false, "reason": "one sentence explaining what is missing or wrong"}`;

  try {
    const message = await getClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }]
    });

    const raw = (message.content[0] as { type: string; text: string }).text.trim();
    // Strip markdown code fences if the model wraps the JSON
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(text) as GuitarCheckResult;
    return parsed;
  } catch {
    // On any failure (parse error, API error) — assume complete so we don't drop valid listings
    return { isComplete: true, reason: "AI check failed — defaulting to include" };
  }
}
