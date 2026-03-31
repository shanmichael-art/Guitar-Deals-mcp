import { scanDealsMarketplace } from "./tools/scanDealsMarketplace.js";
const url = "https://reverb.com/marketplace?query=electric%20guitar&deals_and_steals=true&condition[]=mint&condition[]=excellent&condition[]=very-good&condition[]=good&condition[]=used&condition[]=fair&product_type=electric-guitars&accepts_offers=true&make[]=fender&make[]=gibson&make[]=epiphone&make[]=prs&make[]=ibanez&make[]=squier&make[]=gretsch&make[]=jackson&make[]=schecter&make[]=esp-ltd&make[]=rickenbacker&make[]=suhr&make[]=d-angelico&make[]=danelectro&make[]=charvel&make[]=godin&exclude_local_pickup_only=true";
async function main() {
    const results = await scanDealsMarketplace({
        marketplaceUrl: url,
        maxListings: 10
    });
    console.log(JSON.stringify(results, null, 2));
}
main().catch(console.error);
