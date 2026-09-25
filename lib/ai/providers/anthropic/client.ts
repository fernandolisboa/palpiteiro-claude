import Anthropic from "@anthropic-ai/sdk";

import { CLIENT_MAX_RETRIES, CLIENT_TIMEOUT_MS } from "./timeouts";

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
    maxRetries: CLIENT_MAX_RETRIES,
    timeout: CLIENT_TIMEOUT_MS,
  });
  return client;
}

// Padrão SportMonks/#227 (ADR 0026): capability flag pra audiência/roteamento.
// `false` ⇒ provider filtrado/inerte (nunca roteado). No #230 o Anthropic é o
// único provider e o default reproduzível, então sempre tem chave em prod.
export function hasKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
