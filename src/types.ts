export type ListingCard = {
  title: string;
  url: string;
  price: number;
  shipping: number;
  condition?: string | null;
  watchers?: number | null;
  offers?: number | null;
  listedAgeText?: string | null;
};

export type ListingAnalysis = {
  rawTitle: string;
  listingUrl: string;
  normalizedTitle: string | null;
  modelPageUrl: string | null;
  askPrice: number;
  shippingPrice: number;
  totalPrice: number;
  condition: string | null;
  description: string | null;
  issuesFound: string[];
  offersCount: number | null;
  listedAgeText: string | null;
  confidence: number;
};

export type ModelMarketData = {
  canonicalTitle: string;
  modelPageUrl: string;
  priceGuideCondition: string | null;
  estimatedValue: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  lowestActiveListings: Array<{
    title: string;
    price: number;
    shipping: number;
    total: number;
    url: string;
  }>;
  recentSales: Array<{
    date: string;
    condition: string;
    price: number;
  }>;
};

export type DealScore = {
  outboundShipping: number;
  strongOffer: number;
  walkAwayMax: number;
  spreadToEstimatedValue: number | null;
  verdict: "strong" | "promising" | "watch" | "pass";
  notes: string[];
};