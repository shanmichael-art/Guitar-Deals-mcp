import { z } from "zod";
import { getPage } from "../lib/browser.js";
import type { ListingCard } from "../types.js";

export const ScanDealsMarketplaceSchema = z.object({
  marketplaceUrl: z.string().url(),
  maxListings: z.number().int().min(1).max(100).default(25)
});

export async function scanDealsMarketplace(
  args: z.infer<typeof ScanDealsMarketplaceSchema>
): Promise<ListingCard[]> {
  const page = await getPage();

  await page.goto(args.marketplaceUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  // Let JS hydrate the page
  await page.waitForTimeout(5000);

  // Scroll incrementally to load all lazy-loaded listings
  const scrollsNeeded = Math.ceil(args.maxListings / 4); // ~4 listings per viewport
  for (let i = 0; i < scrollsNeeded; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1500);

  // Wait for at least one listing link to appear
  await page.waitForFunction(() => {
    return document.querySelectorAll('a[href*="/item/"]').length > 0;
  }, { timeout: 20000 }).catch(() => null);

  const listings: ListingCard[] = await page.evaluate((maxListings) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/item/"]')) as HTMLAnchorElement[];

    // Deduplicate by base URL (strip tracking params) — each card has 2 anchors (image + title)
    // and Reverb sometimes appends ?bk=... tracking tokens to some anchors
    const seenHrefs = new Set<string>();
    const uniqueAnchors: HTMLAnchorElement[] = [];
    for (const a of anchors) {
      if (!a.href || !(/\/item\//.test(a.href))) continue;
      const baseHref = a.href.split("?")[0];
      if (seenHrefs.has(baseHref)) continue;
      seenHrefs.add(baseHref);
      uniqueAnchors.push(a);
    }

    const results: any[] = [];

    for (const a of uniqueAnchors) {
      // Find the listing card: prefer <li>, then <article>, then walk up looking for a card-sized container
      const container: Element =
        a.closest("li") ??
        a.closest("article") ??
        (() => {
          let el: Element = a;
          for (let i = 0; i < 8; i++) {
            const p = el.parentElement;
            if (!p || p.tagName === "BODY") break;
            el = p;
            if ((p.textContent?.trim().length ?? 0) > 100) break;
          }
          return el;
        })();

      // Use Reverb's specific CSS classes for reliable extraction
      const titleEl =
        container.querySelector(".rc-listing-card__title") ??
        container.querySelector("h2, h3, h4");
      const title = titleEl?.textContent?.trim() ?? "";
      if (!title || title.length < 3) continue;

      // Price: use the dedicated price element, fall back to first dollar in text
      const priceEl = container.querySelector(".rc-price-block__price");
      const priceText = priceEl?.textContent?.trim() ?? "";
      const price = priceText
        ? Number(priceText.replace(/[$,]/g, ""))
        : (() => {
            const m = (container.textContent ?? "").match(/\$[\d,]+(?:\.\d{2})?/);
            return m ? Number(m[0].replace(/[$,]/g, "")) : 0;
          })();
      if (!price || price <= 0) continue;

      // Condition: "Used – Excellent" → "Excellent", "Mint" → "Mint"
      const condEl = container.querySelector(".rc-listing-card__condition");
      const condText = condEl?.textContent?.trim() ?? "";
      // Prefer the grade after the em-dash (e.g. "Used – Excellent" → "Excellent")
      const condition =
        condText.match(/[–\-]\s*(Mint|Excellent|Very Good|Good|Fair)/i)?.[1] ??
        condText.match(/^(Mint|Excellent|Very Good|Good|Fair)/i)?.[1] ??
        null;

      // Shipping: NOT present in marketplace card DOM — will be fetched by analyzeListing
      const shipping = 0;

      // Offers proxy: parse "In 4 Other Carts" → 4, or null
      const nudgeLabels = Array.from(
        container.querySelectorAll(".rc-nudge__icon__label")
      ).map(el => el.textContent?.trim() ?? "");
      const cartsMatch = nudgeLabels.join(" ").match(/In\s+(\d+)\s+Other\s+Cart/i);
      const offers = cartsMatch ? Number(cartsMatch[1]) : null;

      results.push({
        title,
        url: a.href.split("?")[0],
        price,
        shipping,
        condition,
        watchers: null,
        offers,
        listedAgeText: null
      });

      if (results.length >= maxListings) break;
    }

    return results;
  }, args.maxListings) as ListingCard[];

  await page.close();
  return listings;
}