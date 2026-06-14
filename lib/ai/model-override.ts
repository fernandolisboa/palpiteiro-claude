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

// Regra de persistência do dropdown entre reanálises (#239). Decide qual valor o
// `<select>` deve EXIBIR após um render, dado:
//  - `displayed`: o que o select mostra agora;
//  - `live`: o valor "vivo" — a última escolha do usuário (ou o seed inicial);
//    é o que DEVE sobreviver a uma reanálise;
//  - `actionCompleted`: a action de análise acabou de concluir (identidade de
//    `state` do useActionState mudou) neste render.
// Quando a action conclui, re-aplicamos `live` — é exatamente isso que impede o
// dropdown de voltar pro "default" depois da reanálise (o bug do #239). Fora
// desse momento o valor exibido é preservado. Retorna `null` quando nada precisa
// mudar, pra o chamador evitar um setState supérfluo. Puro: a sequência
// render → escolha → conclusão da action é testável sem React.
export function resyncModelOverride(args: {
  displayed: string;
  live: string;
  actionCompleted: boolean;
}): string | null {
  const { displayed, live, actionCompleted } = args;
  if (actionCompleted && displayed !== live) {
    return live;
  }
  return null;
}
