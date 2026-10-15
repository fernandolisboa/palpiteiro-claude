// Versão do cálculo da base do modelo por jogo (#555, ADR 0052). Entra no
// fingerprint de cada row e no filtro de leitura do cupom (getMatchModelScoreline):
// mudou a forma das probabilidades, o conjunto de mercados/linhas ou a montagem da
// matriz → bump aqui, e o próximo run grava rows novas pra todos os jogos.
export const MATCH_MODEL_VERSION = "match_model_v1";

// Idade máxima do `checked_at` pra uma base valer nas leituras que tratam a base como
// atual: o seam do cupom (getMatchModelScoreline) e a linha "Modelo: …" do /jogos.
// O cron roda a cada 6h; 24h = vários runs perdidos seguidos.
export const MATCH_MODEL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
