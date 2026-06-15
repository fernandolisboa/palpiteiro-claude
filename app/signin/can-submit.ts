/**
 * Predicado puro do gate de maioridade do /signin (#282): os três métodos de
 * login (Google, passkey, magic link) só ficam habilitados quando o checkbox
 * obrigatório "Declaro ter 18 anos ou mais" está marcado. Extraído como função
 * pura (sem React/DOM) pra ser a regra de gating testável diretamente — o repo
 * não tem harness de evento de DOM (Testing Library/user-event), então a regra
 * "desabilitado sem check / habilitado com check" é coberta aqui em vez de via
 * simulação de clique.
 */
export function canSubmit(accepted: boolean): boolean {
  return accepted;
}
