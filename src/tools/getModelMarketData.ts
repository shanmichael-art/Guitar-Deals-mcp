import { z } from "zod";
import { getPage } from "../lib/browser.js";
import { normalizeCanonicalTitle } from "../lib/normalize.js";
import type { ModelMarketData } from "../types.js";

export const GetModelMarketDataSchema = z.object({
  modelPageUrl: z.string().url(),
  condition: z.string().nullable().optional()
});

// Map our condition strings to Reverb's tab label text
const CONDITION_TAB_MAP: Record<string, string> = {
  Mint: "Mint",
  Excellent: "Excellent",
  "Very Good": "Very Good",
  Good: "Good",
  Fair: "Good" // Reverb doesn't have a Fair tab — use Good
};

export async function getModelMarketData(
  args: z.infer<typeof GetModelMarketDataSchema>
): Promise<ModelMarketData> {
  const page = await getPage();
  await page.goto(args.modelPageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  // Scroll to the Price Guide section at the bottom of the page
  await page.evaluate(() => {
    const el = document.querySelector(".csp-price-guide-module, [class*='price-guide']");
    el?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(2000);

  // If a condition is requested, click its tab in the Price Guide
  const targetCondition = args.condition
    ? CONDITION_TAB_MAP[args.condition] ?? null
    : null;

  if (targetCondition) {
    await page.evaluate((cond) => {
      const module = document.querySelector(".csp-price-guide-module");
      if (!module) return;
      const tabs = Array.from(module.querySelectorAll("button, [role='tab'], [class*='tab']"));
      const tab = tabs.find(
        el => el.textContent?.trim().toLowerCase() === cond.toLowerCase()
      ) as HTMLElement | undefined;
      tab?.click();
    }, targetCondition);
    await page.waitForTimeout(1500);
  }

  const data = await page.evaluate(() => {
    // ── Title ────────────────────────────────────────────────────────────────
    const title =
      document.querySelector("h1")?.textContent?.trim() ||
      document.title ||
      "Unknown";

    // ── Price Guide range ─────────────────────────────────────────────────────
    // .csp-price-estimates__values contains text like "$397 - $656"
    const rangeText =
      document.querySelector(".csp-price-estimates__values, .csp-price-estimates")
        ?.textContent?.trim() ?? "";
    const rangeMatch = rangeText.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)/);
    const lowPrice = rangeMatch ? Number(rangeMatch[1].replace(/,/g, "")) : null;
    const highPrice = rangeMatch ? Number(rangeMatch[2].replace(/,/g, "")) : null;
    const estimatedValue =
      lowPrice !== null && highPrice !== null
        ? Math.round((lowPrice + highPrice) / 2)
        : null;

    // ── Recent transaction history (real sales by condition) ──────────────────
    // csp-transaction-table-container has rows: "Date | Condition | Final Price"
    const txRows = Array.from(
      document.querySelectorAll(
        ".csp-transaction-table-container tr, [class*='transaction'] tr"
      )
    );
    const recentSales = txRows
      .map(row => {
        const cells = Array.from(row.querySelectorAll("td")).map(
          td => td.textContent?.trim() ?? ""
        );
        if (cells.length < 3) return null;
        const priceMatch = cells[2].match(/\$([\d,]+(?:\.\d{2})?)/);
        return priceMatch
          ? { date: cells[0], condition: cells[1], price: Number(priceMatch[1].replace(/,/g, "")) }
          : null;
      })
      .filter((r): r is { date: string; condition: string; price: number } => r !== null)
      .slice(0, 10);

    // ── Lowest active listings ────────────────────────────────────────────────
    // Model pages use the same rc-listing-card structure as marketplace pages
    const seen = new Set<string>();
    const lowestListings: { title: string; url: string; price: number; shipping: number; total: number }[] = [];

    for (const card of Array.from(document.querySelectorAll(".rc-listing-card"))) {
      const linkEl = card.querySelector('a[href*="/item/"]') as HTMLAnchorElement | null;
      if (!linkEl) continue;
      const url = linkEl.href.split("?")[0];
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const cardTitle =
        card.querySelector(".rc-listing-card__title")?.textContent?.trim() ?? "";
      const priceText =
        card.querySelector(".rc-price-block__price")?.textContent?.trim() ?? "";
      const price = priceText ? Number(priceText.replace(/[$,]/g, "")) : 0;
      if (!price) continue;

      lowestListings.push({ title: cardTitle, url, price, shipping: 0, total: price });
      if (lowestListings.length >= 5) break;
    }

    return { title, lowPrice, highPrice, estimatedValue, recentSales, lowestListings };
  });

  await page.close();

  return {
    canonicalTitle: normalizeCanonicalTitle(data.title),
    modelPageUrl: args.modelPageUrl,
    priceGuideCondition: args.condition ?? null,
    estimatedValue: data.estimatedValue,
    lowPrice: data.lowPrice,
    highPrice: data.highPrice,
    lowestActiveListings: data.lowestListings,
    recentSales: data.recentSales
  };
}
