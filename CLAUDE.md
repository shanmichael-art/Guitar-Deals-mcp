# Guitar Deals MCP — Project Context

## What this project is
A TypeScript + Playwright + MCP SDK project that scrapes Reverb.com to find undervalued used electric guitar deals. It runs a full pipeline:

1. **`scanDealsMarketplace`** — navigates Reverb marketplace pages (URL pagination via `&page=N`), scrolls to lazy-load, extracts listing cards
2. **`analyzeListing`** — visits each listing page, extracts price, shipping (including zip-code modal for "Calculate shipping" listings using zip `34609`), condition, description, model page URL
3. **`getModelMarketData`** — visits the Reverb model/CSP page, reads Price Guide by condition tab, extracts recent sales and lowest active listings
4. **`scoreDeal`** — calculates strong offer, walk-away max, spread to estimated value, verdict (strong / promising / watch / pass)

## Running a scan
```bash
npx tsc && node dist/runFullScan.js
```
- Output: timestamped `.csv` and `.html` files in the project root (e.g. `guitar-deals-results-2026-03-31T13-59-23.html`)
- The HTML file has verdict filter buttons and clickable listing links — open it in a browser
- `MAX_LISTINGS` in `src/runFullScan.ts` controls the cap (default 500 = all results)

## Key files
- `src/runFullScan.ts` — main pipeline runner, CSV + HTML output
- `src/tools/scanDealsMarketplace.ts` — marketplace multi-page scraper
- `src/tools/analyzeListing.ts` — individual listing scraper (handles zip-code shipping modal)
- `src/tools/getModelMarketData.ts` — model page Price Guide scraper
- `src/tools/scoreDeal.ts` — deal scoring logic
- `src/lib/browser.ts` — Playwright browser singleton with anti-detection setup
- `src/lib/pricing.ts` — strong offer / walk-away max calculation
- `src/lib/issueScanner.ts` — red flag detection in listing descriptions

## Marketplace URL (current)
```
https://reverb.com/marketplace?query=electric%20guitar&deals_and_steals=true&condition[]=mint&condition[]=excellent&condition[]=very-good&condition[]=good&condition[]=used&condition[]=fair&product_type=electric-guitars&accepts_offers=true&make[]=fender&make[]=gibson&make[]=epiphone&make[]=prs&make[]=ibanez&make[]=squier&make[]=gretsch&make[]=jackson&make[]=schecter&make[]=esp-ltd&make[]=rickenbacker&make[]=suhr&make[]=d-angelico&make[]=danelectro&make[]=charvel&make[]=godin&exclude_local_pickup_only=true
```

## Important implementation details
- **Anti-bot**: headless:false, slowMo:150, `--disable-blink-features=AutomationControlled`, `navigator.webdriver` override, `window.chrome` mock
- **Shipping modal**: when `.listing-shipping-display` shows "Calculate shipping", click the button, fill `#postal_code` with `34609`, click Update button (found by text "Update" or `#rc-modal-action-primary`), wait 3.5s, re-read shipping
- **Concurrency**: 3 parallel listing analyses per batch (`CONCURRENCY = 3`)
- **Scoring thresholds**: spread > $150 = strong, > $50 = promising; any issues = always pass
- **Estimated value blend**: 60% price-guide midpoint + 40% condition-matched recent-sales median
- **Browser singleton**: `initPromise` pattern in `browser.ts` prevents race condition on concurrent `getPage()` calls

## User preferences
- Owner is a guitar reseller/dealer evaluating flip opportunities on Reverb
- Zip code for shipping calculations: `34609`
- Prefers HTML output for browsing results (filter by verdict, click through to listings)
- CSV output kept alongside HTML for data analysis
- headless: false so the browser is visible during runs
