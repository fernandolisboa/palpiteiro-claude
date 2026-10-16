import { vi } from "vitest";

// Mock GLOBAL (PLAN-608 §8/N2): o seam de providers (getProviderForModel →
// withAdoptedVersions → resolveActiveModel) lê o kill switch e as versões adotadas
// do banco em TODA chamada de LLM. ~25 arquivos mockam `@/lib/db` com um select
// genérico que não saberia responder; aqui o estado vira "desligado, nada adotado"
// pra todos, e o seam repassa a conferida. O resto do módulo segue real. Os testes
// da própria adoção (pglite, resolver) desfazem com `vi.unmock`.
vi.mock("@/lib/db/queries/model-versions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/model-versions")>();
  return {
    ...actual,
    getActiveModelState: vi.fn(async () => ({ enabled: false, active: [] })),
  };
});
