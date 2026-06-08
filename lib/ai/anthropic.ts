import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Define it in .env.local (see .env.example).",
    );
  }
  client = new Anthropic({
    apiKey,
    maxRetries: 2,
    timeout: 60_000,
  });
  return client;
}
