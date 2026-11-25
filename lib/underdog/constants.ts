// Chances do azarão (#671, ADR 0073): limiares e versão do cálculo. Mudou fórmula,
// limiar ou constante que mexe nos números do painel → bump UNDERDOG_CALC_VERSION
// (a versão vai gravada na row de underdog_views).

// v2 (#672): sinal de notícia do ge em "Sinais a favor".
export const UNDERDOG_CALC_VERSION = "underdog_calc_v2";

// Diferença mínima, em pontos, entre as vitórias dos dois lados para haver azarão.
export const UNDERDOG_MIN_GAP_PP = 8;

// Materialidade: a row guardada vale como atual enquanto o lado é o mesmo e azarão,
// empate e favorito mudam menos que isto (a base ganha row nova a cada refit do DC).
export const UNDERDOG_MATERIAL_DELTA_PP = 2;

// Cenário que muda a chance do azarão menos que isto sai da lista.
export const SCENARIO_MIN_DELTA_PP = 1;

// Os 3 placares de vitória do azarão mais prováveis.
export const UNDERDOG_SCORELINES = 3;

// Respostas do JEV a partir das quais o fator vira sinal (o JEV marca de 0 a 1).
export const JEV_SIGNAL_MIN = 0.7;

// Confronto direto e forma: até 5 jogos com placar (o mesmo da aba Dados).
export const H2H_LAST = 5;
export const FORM_LAST = 5;
export const H2H_MIN_UNDERDOG_WINS = 2;
export const ABSENCES_MIN_FAVORITE = 3;

// Prazo duro da busca dos sinais (form, H2H, desfalques), depois da cobrança.
export const SIGNALS_TIMEOUT_MS = 5000;

// Minutos que os cenários usam (o texto da IA só pode citar estes).
export const SCENARIO_LEAD_MINUTE = 30;
export const SCENARIO_RED_MINUTE = 60;
