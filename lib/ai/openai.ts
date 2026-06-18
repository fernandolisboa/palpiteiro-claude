// LOAD-BEARING re-export shim (ADR 0027 / #231), espelha lib/ai/anthropic.ts. É o
// especificador que openai.test.ts mocka (vi.mock("@/lib/ai/openai")). O adapter
// importa getOpenAIClient DAQUI (não de ./providers/openai/client) pra que o mock
// intercepte; `hasKey` vem direto de ./client (fora do boundary mockado, pra não
// obrigar todo mock a exportá-lo — vitest 4 é estrito). Não importa o SDK.
export { getOpenAIClient } from "./providers/openai/client";
