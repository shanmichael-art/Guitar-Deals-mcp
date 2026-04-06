/**
 * Full deal-hunting pipeline runner.
 * Scans ~2 pages of Reverb marketplace listings, analyzes each one,
 * fetches Price Guide data for the model, scores the deal, and prints
 * a sorted shortlist.
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { scanDealsMarketplace } from "./tools/scanDealsMarketplace.js";
import { analyzeListing } from "./tools/analyzeListing.js";
import { getModelMarketData } from "./tools/getModelMarketData.js";
import { scoreDeal } from "./tools/scoreDeal.js";
import { closeBrowser } from "./lib/browser.js";
import { isCompleteGuitar } from "./lib/guitarCheck.js";
import type { ListingCard, ListingAnalysis, ModelMarketData, DealScore } from "./types.js";

const MARKETPLACE_URL =
  "https://reverb.com/marketplace?query=electric%20guitar&deals_and_steals=true&condition[]=mint&condition[]=excellent&condition[]=very-good&condition[]=good&condition[]=used&condition[]=fair&product_type=electric-guitars&accepts_offers=true&make[]=fender&make[]=gibson&make[]=epiphone&make[]=prs&make[]=ibanez&make[]=squier&make[]=gretsch&make[]=jackson&make[]=schecter&make[]=esp-ltd&make[]=rickenbacker&make[]=suhr&make[]=d-angelico&make[]=danelectro&make[]=charvel&make[]=godin&exclude_local_pickup_only=true";

const MAX_LISTINGS = 500; // all available results
const CONCURRENCY  = 3;   // parallel listing analyses (be kind to Reverb)

interface ScoredResult {
  card:       ListingCard;
  analysis:   ListingAnalysis;
  marketData: ModelMarketData | null;
  score:      DealScore;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const VERDICT_ORDER = { strong: 0, promising: 1, watch: 2, pass: 3 };

function fmt(n: number) {
  return `$${n.toLocaleString()}`;
}

function printResult(r: ScoredResult, rank: number) {
  const { card, analysis, marketData, score } = r;
  const badge = {
    strong:    "🟢 STRONG",
    promising: "🟡 PROMISING",
    watch:     "🔵 WATCH",
    pass:      "🔴 PASS",
  }[score.verdict];

  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`#${rank}  ${badge}  │  ${card.title}`);
  console.log(`     Ask: ${fmt(analysis.askPrice)}${analysis.shippingPrice ? " + " + fmt(analysis.shippingPrice) + " ship" : " (ship TBD)"}  │  Condition: ${analysis.condition ?? "unknown"}`);

  if (marketData) {
    const range = marketData.lowPrice && marketData.highPrice
      ? `${fmt(marketData.lowPrice)}–${fmt(marketData.highPrice)}`
      : "n/a";
    console.log(`     Price Guide (${analysis.condition ?? "all"}): ${range}  │  Est. value: ${marketData.estimatedValue ? fmt(marketData.estimatedValue) : "n/a"}`);
    if (score.spreadToEstimatedValue !== null) {
      console.log(`     Spread to est. value: ${fmt(score.spreadToEstimatedValue)}`);
    }
  }

  console.log(`     Strong offer: ${fmt(score.strongOffer)}  │  Walk-away max: ${fmt(score.walkAwayMax)}  │  Outbound ship: ${fmt(score.outboundShipping)}`);

  if (score.notes.length) {
    console.log(`     Notes: ${score.notes.join("  |  ")}`);
  }

  if (analysis.issuesFound.length) {
    console.log(`     ⚠️  Issues: ${analysis.issuesFound.join(", ")}`);
  }

  if (marketData?.recentSales?.length) {
    const last3 = marketData.recentSales.slice(0, 3)
      .map(s => `${s.condition} ${fmt(s.price)}`)
      .join(", ");
    console.log(`     Recent sales: ${last3}`);
  }

  console.log(`     🔗 ${card.url}`);
  if (analysis.modelPageUrl) {
    console.log(`     📋 ${analysis.modelPageUrl}`);
  }
}

// ── pipeline ─────────────────────────────────────────────────────────────────

let partsSkipped = 0;

async function processListing(
  card: ListingCard,
  idx: number,
  total: number
): Promise<ScoredResult | null> {
  const tag = `[${idx + 1}/${total}]`;
  try {
    console.log(`${tag} Analyzing ${card.title.substring(0, 50)}...\n`);

    const analysis = await analyzeListing({ listingUrl: card.url });

    if (!analysis.askPrice) {
      console.error(`${tag} Skipped — no ask price`);
      return null;
    }

    // ── AI parts check ──
    const guitarCheck = await isCompleteGuitar(analysis.rawTitle, analysis.description);
    if (!guitarCheck.isComplete) {
      console.log(`${tag} Skipped — not a complete guitar: ${guitarCheck.reason}`);
      partsSkipped++;
      return null;
    }

    // ── Get model market data ──
    let marketData: ModelMarketData | null = null;
    if (analysis.modelPageUrl) {
      try {
        marketData = await getModelMarketData({
          modelPageUrl: analysis.modelPageUrl,
          condition: analysis.condition
        });
      } catch (e) {
        console.error(`${tag} getModelMarketData failed: ${(e as Error).message}`);
      }
    } else {
      console.error(`${tag} No model page URL found — scoring without market data`);
    }

    // ── Use condition-specific median if available for a tighter estimate ──
    let estimatedValue = marketData?.estimatedValue ?? null;
    if (marketData?.recentSales?.length && analysis.condition) {
      const condSales = marketData.recentSales
        .filter(s => s.condition.toLowerCase() === analysis.condition!.toLowerCase())
        .map(s => s.price);
      if (condSales.length >= 2) {
        condSales.sort((a, b) => a - b);
        const mid = Math.floor(condSales.length / 2);
        const median = condSales.length % 2 === 0
          ? Math.round((condSales[mid - 1] + condSales[mid]) / 2)
          : condSales[mid];
        // Blend: 60% price-guide midpoint, 40% recent-sales median
        if (marketData.estimatedValue !== null) {
          estimatedValue = Math.round(marketData.estimatedValue * 0.6 + median * 0.4);
        } else {
          estimatedValue = median;
        }
      }
    }

    const score = await scoreDeal({
      askPrice:       analysis.askPrice,
      shippingPrice:  analysis.shippingPrice,
      estimatedValue,
      issuesFound:    analysis.issuesFound,
      listedAgeText:  analysis.listedAgeText,
      offersCount:    analysis.offersCount
    });

    return { card, analysis, marketData, score };
  } catch (e) {
    console.error(`${tag} Failed: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  Guitar Deal Hunter — Full Scan`);
  console.log(`  Scanning up to ${MAX_LISTINGS} listings (≈2 pages)`);
  console.log(`${"═".repeat(55)}\n`);

  // ── Step 1: Scan marketplace ──
  console.log("📡 Scanning marketplace...");
  const listings = await scanDealsMarketplace({
    marketplaceUrl: MARKETPLACE_URL,
    maxListings: MAX_LISTINGS
  });
  console.log(`✅ Found ${listings.length} listings\n`);

  // ── Step 2: Analyze + score in parallel batches ──
  const results: ScoredResult[] = [];
  const batches = chunk(listings, CONCURRENCY);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchStart = b * CONCURRENCY;
    console.log(`\n▶ Batch ${b + 1}/${batches.length}`);

    const batchResults = await Promise.all(
      batch.map((card, i) => processListing(card, batchStart + i, listings.length))
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }

    // Brief pause between batches to be polite
    if (b < batches.length - 1) {
      await new Promise(res => setTimeout(res, 1500));
    }
  }

  // ── Step 3: Sort and print ──
  const sorted = results.sort(
    (a, b) => VERDICT_ORDER[a.score.verdict] - VERDICT_ORDER[b.score.verdict]
  );

  const counts = {
    strong:    sorted.filter(r => r.score.verdict === "strong").length,
    promising: sorted.filter(r => r.score.verdict === "promising").length,
    watch:     sorted.filter(r => r.score.verdict === "watch").length,
    pass:      sorted.filter(r => r.score.verdict === "pass").length,
  };

  console.log(`\n\n${"═".repeat(55)}`);
  console.log(`  RESULTS: ${sorted.length} deals scored`);
  console.log(`  🟢 Strong: ${counts.strong}  🟡 Promising: ${counts.promising}  🔵 Watch: ${counts.watch}  🔴 Pass: ${counts.pass}`);
  console.log(`  🔩 Parts/incomplete skipped: ${partsSkipped}`);
  console.log(`${"═".repeat(55)}`);

  sorted.forEach((r, i) => printResult(r, i + 1));

  console.log(`\n${"═".repeat(55)}\n`);

  // ── Write CSV ─────────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const csvPath = `guitar-deals-results-${ts}.csv`;
  const csvHeader = [
    "Rank","Verdict","Title","Ask","Shipping","Total Cost","Condition",
    "PG Low","PG High","Est Value","Spread","Strong Offer","Walkaway Max",
    "Outbound Ship","Offers","Listed Age","Issues",
    "Recent Sale 1","Recent Sale 2","Recent Sale 3",
    "Listing URL","Model URL"
  ].join(",");

  const csvRows = sorted.map((r, i) => {
    const { analysis, marketData, score } = r;
    const recentSales = marketData?.recentSales?.slice(0, 3).map(s => `"${s.condition} $${s.price}"`) ?? ["","",""];
    while (recentSales.length < 3) recentSales.push('""');
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
      i + 1,
      score.verdict.toUpperCase(),
      esc(r.card.title),
      analysis.askPrice,
      analysis.shippingPrice,
      analysis.totalPrice,
      analysis.condition ?? "",
      marketData?.lowPrice ?? "",
      marketData?.highPrice ?? "",
      marketData?.estimatedValue ?? "",
      score.spreadToEstimatedValue ?? "",
      score.strongOffer,
      score.walkAwayMax,
      score.outboundShipping,
      analysis.offersCount ?? "",
      analysis.listedAgeText?.replace(/listed\s*/i, "").trim() ?? "",
      esc(analysis.issuesFound.join("; ")),
      ...recentSales,
      analysis.listingUrl,
      analysis.modelPageUrl ?? ""
    ].join(",");
  });

  writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"), "utf8");
  console.log(`💾 CSV saved → ${csvPath}`);

  // ── Write HTML ────────────────────────────────────────────────────────────
  const htmlPath = `guitar-deals-results-${ts}.html`;
  const displayTs = ts.replace("T", " at ").replace(/-(\d{2})-(\d{2})$/, ":$1:$2");

  const verdictStyle: Record<string, { bg: string; border: string; label: string }> = {
    strong:    { bg: "#f0fdf4", border: "#22c55e", label: "🟢 STRONG" },
    promising: { bg: "#fefce8", border: "#eab308", label: "🟡 PROMISING" },
    watch:     { bg: "#eff6ff", border: "#3b82f6", label: "🔵 WATCH" },
    pass:      { bg: "#fef2f2", border: "#ef4444", label: "🔴 PASS" },
  };

  const cardHtml = sorted.map((r, i) => {
    const { analysis, marketData, score } = r;
    const vs = verdictStyle[score.verdict];
    const shipStr = analysis.shippingPrice
      ? `+ $${analysis.shippingPrice.toLocaleString()} ship`
      : "(ship TBD)";
    const pgRange = marketData?.lowPrice && marketData?.highPrice
      ? `$${marketData.lowPrice.toLocaleString()} – $${marketData.highPrice.toLocaleString()}`
      : "n/a";
    const estVal = marketData?.estimatedValue
      ? `$${marketData.estimatedValue.toLocaleString()}`
      : "n/a";
    const spread = score.spreadToEstimatedValue !== null
      ? `${score.spreadToEstimatedValue >= 0 ? "+" : ""}$${score.spreadToEstimatedValue.toLocaleString()}`
      : "n/a";
    const spreadColor = (score.spreadToEstimatedValue ?? 0) >= 0 ? "#16a34a" : "#dc2626";
    const sales = marketData?.recentSales?.slice(0, 3)
      .map(s => `${s.condition} $${s.price.toLocaleString()}`)
      .join(" &nbsp;·&nbsp; ") ?? "n/a";
    const issues = analysis.issuesFound.length
      ? `<div class="issues">⚠️ ${analysis.issuesFound.join(", ")}</div>`
      : "";
    const modelLink = analysis.modelPageUrl
      ? `<a href="${analysis.modelPageUrl}" target="_blank">Price Guide page ↗</a>`
      : "";

    return `
    <div class="card" style="background:${vs.bg};border-left:5px solid ${vs.border}">
      <div class="card-header">
        <span class="rank">#${i + 1}</span>
        <span class="verdict">${vs.label}</span>
        <a class="title" href="${analysis.listingUrl}" target="_blank">${r.card.title} ↗</a>
      </div>
      <div class="card-body">
        <div class="row">
          <div class="col">
            <div class="stat-label">Ask</div>
            <div class="stat-value">$${analysis.askPrice.toLocaleString()} <span class="muted">${shipStr}</span></div>
          </div>
          <div class="col">
            <div class="stat-label">Total Cost</div>
            <div class="stat-value">$${analysis.totalPrice.toLocaleString()}</div>
          </div>
          <div class="col">
            <div class="stat-label">Condition</div>
            <div class="stat-value">${analysis.condition ?? "Unknown"}</div>
          </div>
          <div class="col">
            <div class="stat-label">Est. Value</div>
            <div class="stat-value">${estVal}</div>
          </div>
          <div class="col">
            <div class="stat-label">Spread</div>
            <div class="stat-value" style="color:${spreadColor};font-weight:700">${spread}</div>
          </div>
        </div>
        <div class="row">
          <div class="col">
            <div class="stat-label">Price Guide</div>
            <div class="stat-value">${pgRange}</div>
          </div>
          <div class="col">
            <div class="stat-label">Strong Offer</div>
            <div class="stat-value">$${score.strongOffer.toLocaleString()}</div>
          </div>
          <div class="col">
            <div class="stat-label">Walk-Away Max</div>
            <div class="stat-value">$${score.walkAwayMax.toLocaleString()}</div>
          </div>
          <div class="col">
            <div class="stat-label">Offers</div>
            <div class="stat-value">${analysis.offersCount ?? "—"}</div>
          </div>
          <div class="col">
            <div class="stat-label">Listed</div>
            <div class="stat-value muted">${analysis.listedAgeText?.replace(/listed\s*/i, "").trim() ?? "—"}</div>
          </div>
        </div>
        <div class="footer-row">
          <span class="recent-sales">Recent sales: ${sales}</span>
          ${modelLink}
        </div>
        ${issues}
      </div>
    </div>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Guitar Deals — ${ts}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #64748b; margin-bottom: 20px; font-size: 0.9rem; }
    .summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .badge { padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 0.85rem; }
    .badge-strong    { background: #dcfce7; color: #15803d; }
    .badge-promising { background: #fef9c3; color: #a16207; }
    .badge-watch     { background: #dbeafe; color: #1d4ed8; }
    .badge-pass      { background: #fee2e2; color: #b91c1c; }
    .badge-parts     { background: #f1f5f9; color: #475569; }
    .card { border-radius: 10px; padding: 16px 20px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
    .card-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .rank { font-size: 0.85rem; color: #94a3b8; font-weight: 600; min-width: 30px; }
    .verdict { font-weight: 700; font-size: 0.85rem; white-space: nowrap; }
    .title { font-size: 1rem; font-weight: 600; color: #1d4ed8; text-decoration: none; flex: 1; min-width: 200px; }
    .title:hover { text-decoration: underline; }
    .card-body { display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .col { flex: 1; min-width: 110px; }
    .stat-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 2px; }
    .stat-value { font-size: 0.95rem; font-weight: 500; }
    .muted { color: #64748b; font-weight: 400; font-size: 0.85rem; }
    .footer-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding-top: 6px; border-top: 1px solid rgba(0,0,0,0.06); }
    .recent-sales { font-size: 0.8rem; color: #475569; }
    .footer-row a { font-size: 0.8rem; color: #6366f1; text-decoration: none; }
    .footer-row a:hover { text-decoration: underline; }
    .issues { margin-top: 6px; font-size: 0.82rem; color: #b91c1c; background: #fee2e2; padding: 4px 10px; border-radius: 6px; }
    .filter-bar { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
    .filter-btn { padding: 5px 14px; border-radius: 16px; border: 1px solid #cbd5e1; background: white; cursor: pointer; font-size: 0.82rem; font-weight: 500; }
    .filter-btn.active { background: #1e293b; color: white; border-color: #1e293b; }
  </style>
</head>
<body>
  <h1>🎸 Guitar Deals</h1>
  <div class="subtitle">Scanned ${displayTs} &nbsp;·&nbsp; ${sorted.length} listings scored</div>
  <div class="summary">
    <span class="badge badge-strong">🟢 Strong: ${counts.strong}</span>
    <span class="badge badge-promising">🟡 Promising: ${counts.promising}</span>
    <span class="badge badge-watch">🔵 Watch: ${counts.watch}</span>
    <span class="badge badge-pass">🔴 Pass: ${counts.pass}</span>
    <span class="badge badge-parts">🔩 Parts skipped: ${partsSkipped}</span>
  </div>
  <div class="filter-bar">
    <button class="filter-btn active" onclick="filter('all')">All</button>
    <button class="filter-btn" onclick="filter('strong')">🟢 Strong</button>
    <button class="filter-btn" onclick="filter('promising')">🟡 Promising</button>
    <button class="filter-btn" onclick="filter('watch')">🔵 Watch</button>
    <button class="filter-btn" onclick="filter('pass')">🔴 Pass</button>
  </div>
  <div id="cards">
${cardHtml}
  </div>
  <script>
    function filter(v) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelectorAll('.card').forEach((c, i) => {
        const verdict = ${JSON.stringify(sorted.map(r => r.score.verdict))};
        c.style.display = (v === 'all' || verdict[i] === v) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;

  writeFileSync(htmlPath, html, "utf8");
  console.log(`🌐 HTML saved → ${htmlPath}\n`);

  await closeBrowser();
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await closeBrowser();
  await closeBrowser();
  throw e;
});
