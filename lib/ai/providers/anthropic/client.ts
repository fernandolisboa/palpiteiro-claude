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

// Opções POR REQUEST dos modelos adaptive (#524). O timeout de 60s do client foi
// dimensionado pros temperature (Sonnet 4.5/Haiku, sem thinking); Fable 5.1 / Opus
// 5.5 / Sonnet 5 pensam antes da tool call e passam disso com folga em effort alto.
// 120s × (1 + 1 retry) = 240s cabe no maxDuration=300 da página do jogo; os 2 retries
// do client (3 × 120s) não caberiam. O caminho temperature segue com as opções do
// client, sem mudança.
export const ADAPTIVE_REQUEST_OPTIONS = {
  timeout: 120_000,
  maxRetries: 1,
} as const;

// Padrão SportMonks/#227 (ADR 0026): capability flag pra audiência/roteamento.
// `false` ⇒ provider filtrado/inerte (nunca roteado). No #230 o Anthropic é o
// único provider e o default reproduzível, então sempre tem chave em prod.
export function hasKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
