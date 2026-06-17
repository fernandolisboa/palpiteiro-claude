// LOAD-BEARING re-export shim (ADR 0027 / #230). `buildAnthropicRequest` mudou-se
// pro adapter (`./providers/anthropic/request-builder`). Mantido aqui pra
// `lib/ai/__tests__/request-builder.test.ts` e `scripts/backtest-cartridge.ts`
// (que importam daqui) seguirem verdes, e pro teste de caracterização do
// golden-payload em predict.test.ts reconstruir o request esperado in-test. Não
// importa o SDK — só re-exporta.
export { buildAnthropicRequest } from "./providers/anthropic/request-builder";
