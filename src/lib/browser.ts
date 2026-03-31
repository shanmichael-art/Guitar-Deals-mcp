import { chromium, Browser, BrowserContext, Page } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let initPromise: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  // Serialize initialization so concurrent getPage() calls don't race on
  // browser===null and accidentally launch two browser instances.
  if (!initPromise) {
    initPromise = (async () => {
      console.error("BROWSER: launching browser");
      browser = await chromium.launch({
        headless: false,
        slowMo: 150,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
        ]
      });
      console.error("BROWSER: browser launched");

      console.error("BROWSER: creating context");
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale: "en-US",
        timezoneId: "America/New_York",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
          "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        }
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        (window as any).chrome = { runtime: {} };
      });
      console.error("BROWSER: context created");
    })();
  }
  await initPromise;
}

export async function getPage(): Promise<Page> {
  console.error("BROWSER: getPage called");
  await ensureReady();

  console.error("BROWSER: creating page");
  const page = await context!.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  console.error("BROWSER: page created");
  return page;
}

export async function closeBrowser(): Promise<void> {
  initPromise = null;
  if (context) {
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}
