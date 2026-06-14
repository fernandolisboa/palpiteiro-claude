import { isAIModelId } from "@/lib/ai/models";

// Valor inicial do dropdown de override de modelo (AnalysisPanel). O `<select>`
// é controlado por este valor, e seu sentinel "default" significa "usar a
// cascata server-side" (preferência > default global). Semeamos com a
// PREFERÊNCIA do usuário quando ela for um modelo selecionável válido, pra o
// dropdown já abrir refletindo o modelo que vai REALMENTE rodar — e pra o modelo
// escolhido PERSISTIR entre reanálises (#239) em vez de voltar pro "default".
// Modelos fora da audiência (lista `selectableModels` resolvida no server) caem
// no sentinel: o gate efetivo é server-side, aqui só evitamos um value órfão sem
// <option> correspondente. Puro (sem React/server) pra ser testável isolado.
export function initialModelOverride(
  preferredModelId: string | null,
  selectableModels: { id: string }[],
): string {
  if (
    preferredModelId &&
    isAIModelId(preferredModelId) &&
    selectableModels.some((m) => m.id === preferredModelId)
  ) {
    return preferredModelId;
  }
  return "default";
}
