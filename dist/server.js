import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanDealsMarketplace, ScanDealsMarketplaceSchema } from "./tools/scanDealsMarketplace.js";
import { analyzeListing, AnalyzeListingSchema } from "./tools/analyzeListing.js";
import { getModelMarketData, GetModelMarketDataSchema } from "./tools/getModelMarketData.js";
import { scoreDeal, ScoreDealSchema } from "./tools/scoreDeal.js";
const server = new McpServer({
    name: "guitar-deals-mcp",
    version: "1.0.0"
});
server.tool("scan_deals_marketplace", "Scan a Reverb marketplace page and return raw candidate listings.", {
    marketplaceUrl: z.string().url(),
    maxListings: z.number().int().min(1).max(100).default(25)
}, async (args) => {
    const result = await scanDealsMarketplace(ScanDealsMarketplaceSchema.parse(args));
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2)
            }
        ]
    };
});
server.tool("analyze_listing", "Open a Reverb listing and extract details, model page URL, and issues.", {
    listingUrl: z.string().url()
}, async (args) => {
    const result = await analyzeListing(AnalyzeListingSchema.parse(args));
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2)
            }
        ]
    };
});
server.tool("get_model_market_data", "Open a Reverb model page and extract canonical title, price guide context, and lowest active listings.", {
    modelPageUrl: z.string().url(),
    condition: z.string().nullable().optional()
}, async (args) => {
    const result = await getModelMarketData(GetModelMarketDataSchema.parse(args));
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2)
            }
        ]
    };
});
server.tool("score_deal", "Calculate strong offer and verdict for a guitar listing.", {
    askPrice: z.number(),
    shippingPrice: z.number(),
    estimatedValue: z.number().nullable(),
    issuesFound: z.array(z.string()),
    listedAgeText: z.string().nullable().optional(),
    offersCount: z.number().nullable().optional()
}, async (args) => {
    const result = await scoreDeal(ScoreDealSchema.parse(args));
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2)
            }
        ]
    };
});
const transport = new StdioServerTransport();
await server.connect(transport);
