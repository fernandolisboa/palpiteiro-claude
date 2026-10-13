// Versão do cálculo da base do modelo por jogo (#555, ADR 0052). Entra no
// fingerprint de cada row e no filtro de leitura do cupom (getMatchModelScoreline):
// mudou a forma das probabilidades, o conjunto de mercados/linhas ou a montagem da
// matriz → bump aqui, e o próximo run grava rows novas pra todos os jogos.
export const MATCH_MODEL_VERSION = "match_model_v1";
