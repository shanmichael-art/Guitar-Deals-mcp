import { z } from "zod";
import { getPage } from "../lib/browser.js";
import type { ListingCard } from "../types.js";

export const ScanDealsMarketplaceSchema = z.object({
  marketplaceUrl: z.string().url(),
  maxListings: z.number().int().min(1).max(2000).default(25)
});

// Extract all listing cards visible on the current page DOM
async function extractListingsFromPage(
  page: Awaited<ReturnType<typeof getPage>>,
  seenUrls: Set<string>,
  maxListings: number
): Promise<ListingCard[]> {
  // Scroll through the page to trigger lazy-load
  let lastCount = 0;
  let stallRounds = 0;
  while (stallRounds < 5) {
    const currentCount = await page.evaluate(() =>
      new Set(
        Array.from(document.querySelectorAll('a[href*="/item/"]'))
          .map(a => (a as HTMLAnchorElement).href.split("?")[0])
      ).size
    );
    if (currentCount === lastCount) {
      stallRounds++;
    } else {
      stallRounds = 0;
      lastCount = currentCount;
    }
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1000);

  return (await page.evaluate(([seenArr, max]: [string[], number]) => {
    const seen = new Set(seenArr);
    const anchors = Array.from(document.querySelectorAll('a[href*="/item/"]')) as HTMLAnchorElement[];

    const uniqueAnchors: HTMLAnchorElement[] = [];
    for (const a of anchors) {
      if (!a.href || !(/\/item\//.test(a.href))) continue;
      const baseHref = a.href.split("?")[0];
      if (seen.has(baseHref)) continue;
      seen.add(baseHref);
      uniqueAnchors.push(a);
    }

    const results: any[] = [];

    for (const a of uniqueAnchors) {
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

      const titleEl =
        container.querySelector(".rc-listing-card__title") ??
        container.querySelector("h2, h3, h4");
      const title = titleEl?.textContent?.trim() ?? "";
      if (!title || title.length < 3) continue;

      const priceEl = container.querySelector(".rc-price-block__price");
      const priceText = priceEl?.textContent?.trim() ?? "";
      const price = priceText
        ? Number(priceText.replace(/[$,]/g, ""))
        : (() => {
            const m = (container.textContent ?? "").match(/\$[\d,]+(?:\.\d{2})?/);
            return m ? Number(m[0].replace(/[$,]/g, "")) : 0;
          })();
      if (!price || price <= 0) continue;

      const condEl = container.querySelector(".rc-listing-card__condition");
      const condText = condEl?.textContent?.trim() ?? "";
      const condition =
        condText.match(/[–\-]\s*(Mint|Excellent|Very Good|Good|Fair)/i)?.[1] ??
        condText.match(/^(Mint|Excellent|Very Good|Good|Fair)/i)?.[1] ??
        null;

      const nudgeLabels = Array.from(
        container.querySelectorAll(".rc-nudge__icon__label")
      ).map(el => el.textContent?.trim() ?? "");
      const cartsMatch = nudgeLabels.join(" ").match(/In\s+(\d+)\s+Other\s+Cart/i);

      results.push({
        title,
        url: a.href.split("?")[0],
        price,
        shipping: 0,
        condition,
        watchers: null,
        offers: cartsMatch ? Number(cartsMatch[1]) : null,
        listedAgeText: null
      });

      if (results.length >= max) break;
    }

    return results;
  }, [Array.from(seenUrls), maxListings] as [string[], number])) as ListingCard[];
}

export async function scanDealsMarketplace(
  args: z.infer<typeof ScanDealsMarketplaceSchema>
): Promise<ListingCard[]> {
  const page = await getPage();
  const seenUrls = new Set<string>();
  const allListings: ListingCard[] = [];
  let pageNum = 1;

  while (allListings.length < args.maxListings) {
    // Reverb paginates via &page=N
    const separator = args.marketplaceUrl.includes("?") ? "&" : "?";
    const pageUrl = `${args.marketplaceUrl}${separator}page=${pageNum}`;

    console.log(`  📄 Scanning page ${pageNum} (${allListings.length} listings so far)...`);

    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

    // Check for listing links before proceeding
    const hasListings = await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/item/"]').length > 0,
      { timeout: 15000 }
    ).catch(() => null);

    if (!hasListings) {
      console.log(`  📄 No listings found on page ${pageNum} — stopping.`);
      break;
    }

    const countBefore = allListings.length;
    const pageListings = await extractListingsFromPage(
      page,
      seenUrls,
      args.maxListings - allListings.length
    );

    if (pageListings.length === 0) {
      console.log(`  📄 Page ${pageNum} returned no new listings — stopping.`);
      break;
    }

    // Track seen URLs and accumulate
    for (const listing of pageListings) {
      seenUrls.add(listing.url);
      allListings.push(listing);
    }

    console.log(`  📄 Page ${pageNum}: +${allListings.length - countBefore} listings`);

    pageNum++;

    // Small pause between page navigations
    await page.waitForTimeout(1500);
  }

  await page.close();
  return allListings;
}
