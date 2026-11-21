import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";

// Fontes de notícia POR TIME (ADR 0032, adendo #670). A chave é o time, não a liga: o
// mesmo clube aparece no Brasileirão ("SE Palmeiras", canonical) e na Libertadores
// ("Palmeiras", nome nu), e os dois casam aqui via normalizeTeamName (tira acento e os
// prefixos SE/CR/EC/SC/FC). Time fora da tabela (ligas de fora) → null → a notícia
// cai pra web search.
//
// Fronteira do nome de exibição (#578): `shortName` existe SÓ pra montar a consulta da
// web search (o mecanismo de busca acha "Palmeiras", não "SE Palmeiras"). Nunca vira
// chave, nunca casa time e nunca vai pra tela. Por isso o provider tem os nomes curtos
// dele, sem importar lib/view/team-labels (proibido em lib/providers).

export type TeamNewsSource = {
  // Slug do feed do ge: https://ge.globo.com/rss/ge/futebol/times/<slug>/
  geSlug: string;
  shortName: string;
  // Grafias que resolvem pra este time (canonical, nome nu, grafia da API-Football).
  names: readonly string[];
  // Padrões que contam como "o texto cita este time", aplicados sobre o texto dobrado
  // (minúsculo e sem acento; ver foldText). Nome ambíguo (palavra comum, cidade,
  // estado, sobrenome, outro clube homônimo) só casa em forma de clube: com artigo
  // masculino ("o Vitória", "do Vitória", "contra o Vitória") ou em confronto
  // ("Vitória x", "x Vitória"). Futuro: um feed oficial do clube entra como campo novo.
  mentions: readonly RegExp[];
};

// Minúsculo e sem acento, pontuação preservada (o "x" do confronto e o hífen de
// "Atlético-MG" importam).
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Artigo masculino (sozinho ou contraído) antes do nome: "o", "do", "ao", "no", "pelo".
// "contra o X", "diante do X", "sobre o X" já caem aqui pelo artigo.
const MASC_ARTICLE = String.raw`\b(?:o|do|ao|no|pelo)\s+`;

// Nome ambíguo: casa só com artigo masculino ou em confronto. `name` é regex já dobrada.
function clubForms(name: string, notFollowedBy = ""): RegExp[] {
  const tail = String.raw`\b${notFollowedBy}`;
  return [
    new RegExp(`${MASC_ARTICLE}${name}${tail}`),
    new RegExp(String.raw`\b${name}\s+x\b`),
    new RegExp(String.raw`\bx\s+${name}${tail}`),
  ];
}

// Nome inequívoco: basta aparecer como palavra.
function word(name: string, notFollowedBy = ""): RegExp {
  return new RegExp(String.raw`\b${name}\b${notFollowedBy}`);
}

export const TEAM_NEWS_SOURCES: readonly TeamNewsSource[] = [
  {
    geSlug: "palmeiras",
    shortName: "Palmeiras",
    names: ["SE Palmeiras", "Palmeiras"],
    mentions: [word("palmeiras"), word("verdao")],
  },
  {
    geSlug: "flamengo",
    shortName: "Flamengo",
    names: ["CR Flamengo", "Flamengo"],
    mentions: [word("flamengo"), word("mengao")],
  },
  {
    // "São Paulo" é cidade e estado: "em São Paulo" / "chega a São Paulo" não contam.
    geSlug: "sao-paulo",
    shortName: "São Paulo",
    names: ["São Paulo FC", "Sao Paulo", "São Paulo"],
    mentions: [
      ...clubForms(String.raw`sao paulo`),
      word("spfc"),
      word("tricolor paulista"),
    ],
  },
  {
    geSlug: "corinthians",
    shortName: "Corinthians",
    names: ["SC Corinthians Paulista", "Corinthians"],
    mentions: [word("corinthians")],
  },
  {
    // Santos é sobrenome ("Douglas Santos"); "os santos" também não conta.
    geSlug: "santos",
    shortName: "Santos",
    names: ["Santos FC", "Santos"],
    mentions: [...clubForms("santos"), word("santos fc")],
  },
  {
    geSlug: "vasco",
    shortName: "Vasco",
    names: ["CR Vasco da Gama", "Vasco da Gama", "Vasco"],
    mentions: [word("vasco")],
  },
  {
    // Botafogo-SP (Série B) é outro clube.
    geSlug: "botafogo",
    shortName: "Botafogo",
    names: ["Botafogo FR", "Botafogo"],
    mentions: [
      word("botafogo", String.raw`(?!\s*-\s*sp\b|\s+sp\b)`),
      word("fogao"),
    ],
  },
  {
    geSlug: "fluminense",
    shortName: "Fluminense",
    names: ["Fluminense FC", "Fluminense"],
    mentions: [word("fluminense")],
  },
  {
    // Grêmio Novorizontino e Grêmio Prudente são outros clubes.
    geSlug: "gremio",
    shortName: "Grêmio",
    names: ["Grêmio FBPA", "Gremio", "Grêmio"],
    mentions: [
      word("gremio", String.raw`(?!\s+(?:novorizontino|prudente))`),
      word("imortal tricolor"),
    ],
  },
  {
    // "Internacional" também é adjetivo ("futebol internacional") e "Inter" é a de
    // Milão ou a de Miami: só em forma de clube.
    geSlug: "internacional",
    shortName: "Internacional",
    names: ["SC Internacional", "Internacional"],
    mentions: [
      ...clubForms("internacional"),
      ...clubForms("inter", String.raw`(?!\s+(?:de\s+milao|miami)\b)`),
      word("colorado gaucho"),
    ],
  },
  {
    geSlug: "cruzeiro",
    shortName: "Cruzeiro",
    names: ["Cruzeiro EC", "Cruzeiro"],
    mentions: [word("cruzeiro")],
  },
  {
    // "Atlético" sozinho é ambíguo (MG × PR × Madrid): só a forma com o estado.
    geSlug: "atletico-mg",
    shortName: "Atlético-MG",
    names: [
      "CA Mineiro",
      "Atletico-MG",
      "Atlético-MG",
      "Atletico Mineiro",
      "Atlético Mineiro",
    ],
    mentions: [
      word(String.raw`atletico\s*-\s*mg`),
      word("atletico mineiro"),
      word("galo"),
    ],
  },
  {
    // "Athletico" com h é a grafia do clube paranaense ("Athletic Club" é outro nome).
    geSlug: "athletico-pr",
    shortName: "Athletico-PR",
    names: [
      "CA Paranaense",
      "Athletico-PR",
      "Athletico Paranaense",
      "Atletico Paranaense",
      "Atlético Paranaense",
      "Atletico-PR",
    ],
    mentions: [
      word("athletico"),
      word(String.raw`atletico\s*-\s*pr`),
      word("atletico paranaense"),
    ],
  },
  {
    // Bahia é estado ("na Bahia", "da Bahia"); o clube leva artigo masculino.
    geSlug: "bahia",
    shortName: "Bahia",
    names: ["EC Bahia", "Bahia"],
    mentions: clubForms("bahia"),
  },
  {
    // Vitória é palavra comum ("a vitória"); o clube leva artigo masculino.
    geSlug: "vitoria",
    shortName: "Vitória",
    names: ["EC Vitória", "Vitoria", "Vitória"],
    mentions: [...clubForms("vitoria"), word(String.raw`vitoria\s*-\s*ba`)],
  },
  {
    geSlug: "bragantino",
    shortName: "Bragantino",
    names: ["RB Bragantino", "Red Bull Bragantino", "Bragantino"],
    mentions: [word("bragantino")],
  },
  {
    geSlug: "mirassol",
    shortName: "Mirassol",
    names: ["Mirassol FC", "Mirassol"],
    mentions: [word("mirassol")],
  },
  {
    geSlug: "chapecoense",
    shortName: "Chapecoense",
    names: ["Chapecoense AF", "Chapecoense"],
    mentions: [word("chapecoense")],
  },
  {
    geSlug: "coritiba",
    shortName: "Coritiba",
    names: ["Coritiba FBC", "Coritiba"],
    mentions: [word("coritiba")],
  },
  {
    // Remo também é o esporte ("o remo brasileiro"): só confronto ou o nome completo.
    geSlug: "remo",
    shortName: "Remo",
    names: ["Clube do Remo", "Remo"],
    mentions: [
      word("clube do remo"),
      new RegExp(String.raw`\bremo\s+x\b`),
      new RegExp(String.raw`\bx\s+remo\b`),
      word("contra o remo"),
      word(String.raw`remo\s*-\s*pa`),
    ],
  },
  {
    // Fortaleza é cidade ("em Fortaleza"); o clube leva artigo masculino.
    geSlug: "fortaleza",
    shortName: "Fortaleza",
    names: ["Fortaleza EC", "Fortaleza"],
    mentions: [
      ...clubForms("fortaleza"),
      word("fortaleza ec"),
      word("leao do pici"),
    ],
  },
  {
    // Ceará é estado e leva artigo masculino também ("no Ceará"): só confronto,
    // "contra o Ceará" ou apelido.
    geSlug: "ceara",
    shortName: "Ceará",
    names: ["Ceará SC", "Ceara", "Ceará"],
    mentions: [
      new RegExp(String.raw`\bceara\s+x\b`),
      new RegExp(String.raw`\bx\s+ceara\b`),
      word(String.raw`(?:contra\s+o|diante\s+do)\s+ceara`),
      word("ceara sc"),
      word("vozao"),
    ],
  },
  {
    // Sport é palavra inglesa e prefixo de outros clubes: só em forma de clube.
    geSlug: "sport",
    shortName: "Sport",
    names: ["Sport Recife", "Sport Club do Recife", "Sport"],
    mentions: [
      ...clubForms("sport"),
      word("sport recife"),
      word(String.raw`sport\s*-\s*pe`),
    ],
  },
  {
    // Juventude é palavra comum ("a juventude"); o clube leva artigo masculino.
    geSlug: "juventude",
    shortName: "Juventude",
    names: ["EC Juventude", "Juventude"],
    mentions: clubForms("juventude"),
  },
];

const BY_NORMALIZED_NAME: ReadonlyMap<string, TeamNewsSource> = new Map(
  TEAM_NEWS_SOURCES.flatMap((source) =>
    source.names.map((name) => [normalizeTeamName(name), source] as const)
  )
);

export function resolveTeamSources(name: string): TeamNewsSource | null {
  return BY_NORMALIZED_NAME.get(normalizeTeamName(name)) ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Padrões que contam como "o texto cita este time" (sobre texto dobrado). Time fora da
 * tabela cai no nome inteiro como palavra (cru e normalizado).
 */
export function mentionTermsFor(name: string): readonly RegExp[] {
  const source = resolveTeamSources(name);
  if (source) return source.mentions;
  const forms = new Set(
    [foldText(name).trim(), normalizeTeamName(name)].filter(
      (f) => f.length >= 3
    )
  );
  return [...forms].map((f) =>
    word(escapeRegex(f).replace(/\s+/g, String.raw`\s+`))
  );
}

export function textMentionsTeam(text: string, name: string): boolean {
  const folded = foldText(text);
  return mentionTermsFor(name).some((re) => re.test(folded));
}

/**
 * Nome curto SÓ pra consulta da web search (ver o cabeçalho: fronteira do #578). Time
 * fora da tabela segue com o nome que veio.
 */
export function newsShortName(name: string): string {
  return resolveTeamSources(name)?.shortName ?? name;
}
