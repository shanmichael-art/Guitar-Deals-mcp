import { z } from "zod";
import { calculateStrongOffer } from "../lib/pricing.js";
import type { DealScore } from "../types.js";

export const ScoreDealSchema = z.object({
  askPrice: z.number(),
  shippingPrice: z.number(),
  estimatedValue: z.number().nullable(),
  issuesFound: z.array(z.string()),
  listedAgeText: z.string().nullable().optional(),
  offersCount: z.number().nullable().optional()
});

export async function scoreDeal(args: z.infer<typeof ScoreDealSchema>): Promise<DealScore> {
  const { outboundShipping, strongOffer, walkAwayMax } = calculateStrongOffer(
    args.askPrice,
    args.shippingPrice
  );

  const notes: string[] = [];
  let verdict: DealScore["verdict"] = "watch";

  const spreadToEstimatedValue =
    args.estimatedValue != null
      ? Math.floor(args.estimatedValue - (args.askPrice + args.shippingPrice))
      : null;

  if (args.issuesFound.length > 0) {
    notes.push(`Red flags: ${args.issuesFound.join(", ")}`);
  }

  // Issues are disqualifying — always "pass" regardless of spread
  if (args.issuesFound.length > 0) {
    verdict = "pass";
  } else if (spreadToEstimatedValue != null && spreadToEstimatedValue > 150) {
    verdict = "strong";
  } else if (spreadToEstimatedValue != null && spreadToEstimatedValue > 50) {
    verdict = "promising";
  }

  if (args.offersCount != null) {
    notes.push(`Current offers: ${args.offersCount}`);
  }

  if (args.listedAgeText) {
    notes.push(`Listing age: ${args.listedAgeText}`);
  }

  return {
    outboundShipping,
    strongOffer,
    walkAwayMax,
    spreadToEstimatedValue,
    verdict,
    notes
  };
}