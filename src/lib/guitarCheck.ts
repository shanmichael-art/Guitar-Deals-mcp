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
Given a listing title and description, determine whether this is a COMPLETE guitar (ready to play as-is, or needing only minor setup) or something else — such as a body only, neck only, parts lot, hardware-only listing, unfinished build, or project guitar missing major components.

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

    const text = (message.content[0] as { type: string; text: string }).text.trim();
    const parsed = JSON.parse(text) as GuitarCheckResult;
    return parsed;
  } catch {
    // On any failure (parse error, API error) — assume complete so we don't drop valid listings
    return { isComplete: true, reason: "AI check failed — defaulting to include" };
  }
}
