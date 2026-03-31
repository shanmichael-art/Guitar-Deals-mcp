import { z } from "zod";
import { getPage } from "../lib/browser.js";
import { scanListingIssues } from "../lib/issueScanner.js";
import { normalizeCanonicalTitle } from "../lib/normalize.js";
export const AnalyzeListingSchema = z.object({
    listingUrl: z.string().url()
});
export async function analyzeListing(args) {
    const page = await getPage();
    await page.goto(args.listingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Wait for the price block to render
    await page.waitForSelector(".price-display, .price-with-shipping__price__amount", {
        timeout: 15000
    }).catch(() => null);
    await page.waitForTimeout(2000);
    // Scroll down to load description and model info
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(1500);
    const raw = await page.evaluate(() => {
        // ── Title ────────────────────────────────────────────────────────────────
        const title = document.querySelector("h1")?.textContent?.trim() ||
            document.title ||
            "Unknown";
        // ── Price ─────────────────────────────────────────────────────────────────
        // .price-display contains the clean "$550" — ignore "Typical new price" widget
        const priceText = document.querySelector(".price-display")?.textContent?.trim() ?? "";
        const askPrice = priceText
            ? Number(priceText.replace(/[$,]/g, ""))
            : (() => {
                const m = document.body.innerText.match(/\$[\d,]+/);
                return m ? Number(m[0].replace(/[$,]/g, "")) : 0;
            })();
        // ── Shipping ──────────────────────────────────────────────────────────────
        // .listing-shipping-display shows either "Calculate shipping", "Free Shipping",
        // or a fixed amount like "$15 Shipping". Only record a number when explicit.
        const shipEl = document.querySelector(".listing-shipping-display");
        const shipText = shipEl?.textContent?.trim() ?? "";
        const shipMatch = shipText.match(/\$([\d,]+(?:\.\d{2})?)/);
        const shippingPrice = shipMatch ? Number(shipMatch[1].replace(/,/g, "")) : 0;
        const needsZipCalc = shippingPrice === 0 && /calculate\s+shipping/i.test(shipText);
        // ── Condition ─────────────────────────────────────────────────────────────
        // "Used – Excellent" → "Excellent"
        const condText = document.querySelector(".condition-display__label")?.textContent?.trim() ?? "";
        const condMatch = condText.match(/[–\-]\s*(Mint|Excellent|Very Good|Good|Fair)/i)?.[1] ??
            condText.match(/^(Mint|Excellent|Very Good|Good|Fair)/i)?.[1] ??
            null;
        // ── Description ───────────────────────────────────────────────────────────
        // Reverb puts the seller's description in a dedicated section. Try known
        // class patterns first, then fall back to the first substantive text block
        // in the main content that isn't navigation or pricing.
        const NAV_KEYWORDS = /log in|sign up|favorites|cart|help center|reverb gives|artist shop/i;
        const descEl = document.querySelector("[class*='description'], [class*='seller-notes'], [class*='item2-description']") ??
            Array.from(document.querySelectorAll("main p, main div, main section"))
                .find(el => {
                const t = el.textContent?.trim() ?? "";
                return (t.length > 80 &&
                    t.length < 4000 &&
                    !NAV_KEYWORDS.test(t) &&
                    el.offsetHeight > 0);
            });
        const description = descEl?.textContent?.replace(/\s+/g, " ").trim() ?? null;
        // ── Model page link ───────────────────────────────────────────────────────
        // Pick the /p/ link that has meaningful link text (not empty)
        const modelLink = Array.from(document.querySelectorAll('a[href*="/p/"]'))
            .find(a => a.textContent?.trim().length > 3)?.href ?? null;
        // ── Offers & listed age ───────────────────────────────────────────────────
        const bodyText = document.body.innerText;
        const offersMatch = bodyText.match(/(\d+)\s+offer/i);
        const listedMatch = bodyText.match(/listed\s+\d+\s+\w+\s+ago/i);
        return {
            title,
            askPrice,
            shippingPrice,
            needsZipCalc,
            condText,
            condition: condMatch,
            description,
            modelLink,
            offersCount: offersMatch ? Number(offersMatch[1]) : null,
            listedAgeText: listedMatch ? listedMatch[0] : null
        };
    });
    // ── Zip-based shipping calculation ─────────────────────────────────────────
    // If shipping shows "Calculate shipping", open the modal, enter zip, submit,
    // and read the updated shipping cost.
    let shippingPrice = raw.shippingPrice;
    if (raw.needsZipCalc) {
        try {
            // Click the "Calculate shipping" button inside .listing-shipping-display
            await page.click(".listing-shipping-display button");
            // Wait for the modal's zip input to appear
            await page.waitForSelector("#postal_code", { timeout: 8000 });
            // Clear and fill the zip code
            await page.fill("#postal_code", "34609");
            // Click the "Update" button — try multiple selectors in order
            const updateClicked = await page.evaluate(() => {
                // Try id first, then find any button/submit with "Update" text in the modal
                const byId = document.querySelector("#rc-modal-action-primary");
                if (byId) {
                    byId.click();
                    return true;
                }
                const allBtns = Array.from(document.querySelectorAll("button, input[type='submit']"));
                const updateBtn = allBtns.find(b => /^update$/i.test(b.textContent?.trim() ?? "") || /^update$/i.test(b.value ?? ""));
                if (updateBtn) {
                    updateBtn.click();
                    return true;
                }
                return false;
            });
            if (!updateClicked) {
                // Last resort: press Enter in the zip field
                await page.press("#postal_code", "Enter");
            }
            // Wait for the shipping display to update (modal closes and price appears)
            await page.waitForTimeout(3500);
            // Re-read the shipping element
            const updatedShipText = await page.evaluate(() => document.querySelector(".listing-shipping-display")?.textContent?.trim() ?? "");
            const updatedMatch = updatedShipText.match(/\$([\d,]+(?:\.\d{2})?)/);
            if (updatedMatch) {
                shippingPrice = Number(updatedMatch[1].replace(/,/g, ""));
            }
        }
        catch {
            // Could not calculate — leave shippingPrice as 0
        }
    }
    const normalizedTitle = raw.modelLink
        ? null
        : normalizeCanonicalTitle(raw.title);
    const issuesFound = scanListingIssues(raw.description);
    await page.close();
    return {
        rawTitle: raw.title,
        listingUrl: args.listingUrl,
        normalizedTitle,
        modelPageUrl: raw.modelLink,
        askPrice: raw.askPrice,
        shippingPrice,
        totalPrice: raw.askPrice + shippingPrice,
        condition: raw.condition,
        description: raw.description,
        issuesFound,
        offersCount: raw.offersCount,
        listedAgeText: raw.listedAgeText,
        confidence: raw.modelLink ? 0.95 : 0.4
    };
}
