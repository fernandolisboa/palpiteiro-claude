// Janelas temporais do CLV (#180). Forward-capture: a closing line é capturada AO
// VIVO perto do kickoff (nenhum provider dá odds históricas de fechamento — ADR 0025).
//
// CAPTURA: o cron (a cada 30min) busca odds dos jogos com KO nos próximos 90min que
// têm predição non-pass. O gate de frescor de 30min (ODDS_SNAPSHOT_FRESHNESS_MS) faz
// o último fetch pré-KO cair em ~[KO−30min, KO].
export const CLV_CAPTURE_LOOKAHEAD_MS = 90 * 60 * 1000;

// LEITURA: a "closing line" de uma predição é o ÚLTIMO snapshot em [KO−40min, KO].
// 40min (> 30min do gate + cadência do cron) pega o capture de fechamento E DESCARTA
// snapshots de análise mais velhos — assim o CLV fica `null` (honesto) quando não há
// captura genuína perto do KO, em vez de comparar com uma odd de horas/dias antes e
// fabricar um CLV≈0 enganoso. [[prefer-skip-over-silent-wrong-settle]]
export const CLV_CLOSING_WINDOW_MS = 40 * 60 * 1000;
