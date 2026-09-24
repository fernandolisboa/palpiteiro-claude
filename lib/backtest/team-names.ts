// Mapa nome-do-CSV (football-data.co.uk) → nome canônico do catálogo
// (`CANONICAL_TEAMS.brasileirao_a`). Só os times do catálogo atual; os demais
// (rebaixados fora do catálogo) passam como estão — o backtest é consistente
// internamente pelos nomes do CSV, o mapa só serve pra cruzar com dados do app
// (estratégias que chamam providers/LLM, ex.: Sonnet/JEV).
export const FOOTBALL_DATA_TO_CANONICAL: Readonly<Record<string, string>> = {
  "Athletico-PR": "CA Paranaense",
  "Atletico-MG": "CA Mineiro",
  Bahia: "EC Bahia",
  "Botafogo RJ": "Botafogo FR",
  Bragantino: "RB Bragantino",
  "Chapecoense-SC": "Chapecoense AF",
  Corinthians: "SC Corinthians Paulista",
  Coritiba: "Coritiba FBC",
  Cruzeiro: "Cruzeiro EC",
  "Flamengo RJ": "CR Flamengo",
  Fluminense: "Fluminense FC",
  Gremio: "Grêmio FBPA",
  Internacional: "SC Internacional",
  Mirassol: "Mirassol FC",
  Palmeiras: "SE Palmeiras",
  Remo: "Clube do Remo",
  Santos: "Santos FC",
  "Sao Paulo": "São Paulo FC",
  Vasco: "CR Vasco da Gama",
  Vitoria: "EC Vitória",
};

export function toCanonicalTeam(csvName: string): string {
  return FOOTBALL_DATA_TO_CANONICAL[csvName] ?? csvName;
}
