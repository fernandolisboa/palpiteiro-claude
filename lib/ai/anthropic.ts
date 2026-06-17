// LOAD-BEARING re-export shim (ADR 0027 / #230). A implementação real vive em
// `./providers/anthropic/client`. Este especificador (`@/lib/ai/anthropic`) é o
// boundary que TODOS os harnesses de teste de predict mockam via `vi.mock`
// (predict.test.ts:132) e por onde `scripts/replay-prompt-eval.ts` +
// `scripts/backtest-cartridge.ts` importam o client — o adapter Anthropic importa
// `getAnthropicClient` DAQUI (não de `./providers/anthropic/client`) pra que o mock
// intercepte. NÃO delete nem aponte os consumidores direto pro `./client`: quebra
// o mock boundary (chamada paga real / throw de key) silenciosamente. Não importa
// o SDK — só re-exporta. (Re-exporta SÓ getAnthropicClient: é o que precisa ser
// mockável; `hasKey` é importado direto de ./providers/anthropic/client, fora do
// boundary mockado, pra não obrigar todo mock de teste a também exportá-lo.)
export { getAnthropicClient } from "./providers/anthropic/client";
