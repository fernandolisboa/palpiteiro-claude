// Mensagem do limite diário de palpites (`checkPalpitesRateLimit`), uma só para todas as
// ações que cobram desse balde (ADR 0072 §8): gerar o palpite, o "Seu palpite", o
// "Explicar com IA" e as chances do azarão.
export function palpitesLimitMessage(limit: number): string {
  return `Você atingiu o limite de ${limit} usos por dia (palpites, Seu palpite, explicações e chances do azarão). Tente novamente amanhã.`;
}
