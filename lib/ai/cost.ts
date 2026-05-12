// Anthropic pricing per million tokens (USD). Source:
// https://platform.claude.com/docs/en/docs/about-claude/pricing (Sonnet 4.5).
// Cache write/read tiers omitted — MVP does not use prompt caching.
export const MODEL_PRICING_USD_PER_MTOK = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
} as const;

export type PricedModel = keyof typeof MODEL_PRICING_USD_PER_MTOK;

export function calculateCost(args: {
  model: PricedModel;
  inputTokens: number;
  outputTokens: number;
}): number {
  const p = MODEL_PRICING_USD_PER_MTOK[args.model];
  return (args.inputTokens * p.input + args.outputTokens * p.output) / 1_000_000;
}
