import OpenAI from "openai";

let client: OpenAI | undefined;

// requireKey só no caminho pago (padrão SportMonks/#227): com OPENAI_API_KEY
// ausente o provider é INERTE (filtrado de modelsForAudience, nunca roteado), então
// este throw é um backstop — não deve ser alcançado pelo fluxo normal do app.
export function getOpenAIClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Define it in .env.local (see .env.example).",
    );
  }
  client = new OpenAI({
    apiKey,
    maxRetries: 2,
    timeout: 60_000,
  });
  return client;
}

// Capability flag (ADR 0027): sem chave ⇒ provider inerte. providerHasKey em
// models.ts faz o gate de seleção; este hasKey é o do adapter (mesma fonte: env).
export function hasKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
