import type { FixtureRef } from "@/lib/providers/sports-data/types";

// Seam ESTREITO do estado ao vivo (#591, PLAN-580 §5.1), no molde de
// lib/providers/absences/ (ADR 0026): só placar, minuto e expulsões de um jogo em
// andamento, separado da SportsDataProvider gorda. Sem fallback de provider (decisão 2
// do dono): falhou, volta null e quem chama mostra a última leitura com a idade.

export type LiveProviderName = "api_football";

export type NormalizedLiveState = {
  // id do fixture no provider (vai pra match_live_states.provider_fixture_id: as
  // buscas seguintes pulam a resolução por data + nomes).
  providerFixtureId: number;
  // Código curto do provider (1H, HT, 2H, ET, BT, P, LIVE, INT, SUSP, FT, …): a fase
  // sai daqui em lib/live/phase.ts.
  statusShort: string;
  // Minuto corrido do relógio do provider; null antes do apito ou quando não vem.
  elapsed: number | null;
  // Acréscimos do tempo em andamento (45+2' = elapsed 45, extra 2); null quando não vem.
  extra: number | null;
  // `goals` do provider: em 1H/HT/2H é o placar de 90' em andamento (em ET já inclui a
  // prorrogação). null quando o provider não manda os dois números (antes do apito).
  goals: { home: number; away: number } | null;
  // Expulsões por time (vermelho direto + segundo amarelo). null = sem dados de eventos
  // (o modelo em jogo roda sem ajuste e a tela diz "sem dados de expulsão").
  red: { home: number; away: number } | null;
  // Placar da disputa de pênaltis (convertidos por time). null fora da disputa ou sem dado.
  penalties: { home: number; away: number } | null;
  // Instante da resposta HTTP (não o do upsert nem o da leitura de cache, R12).
  fetchedAt: Date;
};

export type LiveStateRequest = {
  ref: FixtureRef;
  // Id já resolvido numa busca anterior (match_live_states.provider_fixture_id).
  // Ausente/null → resolve por (data UTC do kickoff, liga, nomes canônicos).
  providerFixtureId?: number | null;
};

export interface LiveStateProvider {
  readonly name: LiveProviderName;
  // Freio de cota (PLAN-580 §5.3): true quando a última leitura de cota desta
  // instância está abaixo do limiar. getLiveState já não busca nesse caso; exposto
  // pra quem quiser decidir antes (ex.: não tomar o lease da row).
  isQuotaLow(): boolean;
  // Nunca lança: rede, HTTP, Zod, teto de tempo, jogo não encontrado ou cota baixa →
  // null, com log estruturado.
  getLiveState(req: LiveStateRequest): Promise<NormalizedLiveState | null>;
}
