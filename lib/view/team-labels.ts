import type { LeagueKey } from "@/lib/view/types";

// Tradução DISPLAY-ONLY dos nomes das seleções da Copa (canonical EN → PT-BR).
//
// PRINCÍPIO INEGOCIÁVEL: o nome canonical em inglês ("Mexico", "South Korea") é
// CHAVE DE MATCHING em todo o sistema — odds, prompts de IA, H2H, settlement, DB.
// Esta tradução vive SÓ na borda de view (no `Team.name` exibido) e nunca altera
// o canonical. Por isso o gate por liga: só `world_cup` ('wc') traduz; clubes
// (brasileirao/champions) passam verbatim — nomes de clube não se traduzem.
//
// Cobre as 48 seleções de CANONICAL_TEAMS.world_cup. Um teste garante que todas
// estão mapeadas; nome não-mapeado degrada graciosamente pro canonical EN.
const WC_TEAM_LABELS_PT: Record<string, string> = {
  Algeria: "Argélia",
  Argentina: "Argentina",
  Australia: "Austrália",
  Austria: "Áustria",
  Belgium: "Bélgica",
  "Bosnia & Herzegovina": "Bósnia e Herzegovina",
  Brazil: "Brasil",
  Canada: "Canadá",
  "Cape Verde Islands": "Cabo Verde",
  Colombia: "Colômbia",
  "Congo DR": "RD Congo",
  Croatia: "Croácia",
  Curaçao: "Curaçao",
  "Czech Republic": "República Tcheca",
  Ecuador: "Equador",
  Egypt: "Egito",
  England: "Inglaterra",
  France: "França",
  Germany: "Alemanha",
  Ghana: "Gana",
  Haiti: "Haiti",
  Iran: "Irã",
  Iraq: "Iraque",
  "Ivory Coast": "Costa do Marfim",
  Japan: "Japão",
  Jordan: "Jordânia",
  Mexico: "México",
  Morocco: "Marrocos",
  // "Holanda" (uso corrente no Brasil) em vez de "Países Baixos" — flip de 1 linha.
  Netherlands: "Holanda",
  "New Zealand": "Nova Zelândia",
  Norway: "Noruega",
  Panama: "Panamá",
  Paraguay: "Paraguai",
  Portugal: "Portugal",
  Qatar: "Catar",
  "Saudi Arabia": "Arábia Saudita",
  Scotland: "Escócia",
  Senegal: "Senegal",
  "South Africa": "África do Sul",
  "South Korea": "Coreia do Sul",
  Spain: "Espanha",
  Sweden: "Suécia",
  Switzerland: "Suíça",
  Tunisia: "Tunísia",
  Türkiye: "Turquia",
  USA: "Estados Unidos",
  Uruguay: "Uruguai",
  Uzbekistan: "Uzbequistão",
};

/**
 * Rótulo de exibição de um time. Para `world_cup` ('wc') retorna o nome da
 * seleção em PT-BR; para qualquer outra liga (clubes) retorna o canonical
 * inalterado. Display-only — nunca usar como chave de matching.
 */
export function displayTeamName(
  canonicalName: string,
  league: LeagueKey,
): string {
  if (league !== "wc") return canonicalName;
  return WC_TEAM_LABELS_PT[canonicalName] ?? canonicalName;
}

// Exportado só pro teste de completude (todas as 48 seleções mapeadas).
export { WC_TEAM_LABELS_PT };
