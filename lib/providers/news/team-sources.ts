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

// Verbos de jogo que pedem o nome do clube logo depois (ou antes, como sujeito):
// "Flamengo vence Remo", "Corinthians recebe São Paulo", "Santos empata com Palmeiras".
const MATCH_VERBS = String.raw`(?:vence|venceu|recebe|recebeu|enfrenta|enfrentou|encara|encarou|pega|pegou|goleia|goleou|empata\s+com|empatou\s+com|perde\s+para|perdeu\s+para|bate|bateu)`;

// Forma de jogo pra nome ambíguo: depois de um verbo de jogo ("vence Remo") ou como
// sujeito no começo da manchete ou da oração ("Santos empata com…"). Sujeito só no
// começo pra "Douglas Santos vence prêmio" não contar.
function verbForms(name: string, tail: string): RegExp[] {
  return [
    new RegExp(String.raw`\b${MATCH_VERBS}\s+${name}${tail}`),
    new RegExp(String.raw`(?:^|[:;!?.]\s+)${name}${tail}\s+${MATCH_VERBS}\b`),
  ];
}

// Nome ambíguo: casa só com artigo masculino, em confronto ou em forma de jogo.
// `name` é regex já dobrada.
function clubForms(name: string, notFollowedBy = ""): RegExp[] {
  const tail = String.raw`\b${notFollowedBy}`;
  return [
    new RegExp(`${MASC_ARTICLE}${name}${tail}`),
    new RegExp(String.raw`\b${name}\s+x\b`),
    new RegExp(String.raw`\bx\s+${name}${tail}`),
    ...verbForms(name, tail),
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
      ...verbForms("remo", String.raw`\b`),
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
      ...verbForms("ceara", String.raw`\b`),
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

// Termo literal como "palavra": `\b` só nas pontas que são caractere de palavra
// ("Estudiantes L.P." termina em ponto; um `\b` depois dele nunca casaria).
function literalTerm(folded: string): RegExp {
  const body = escapeRegex(folded).replace(/\s+/g, String.raw`\s+`);
  const head = /^\w/.test(folded) ? String.raw`\b` : "";
  const tail = /\w$/.test(folded) ? String.raw`\b` : "";
  return new RegExp(`${head}${body}${tail}`);
}

// Tokens que não identificam um clube estrangeiro: artigo/preposição e sigla ou palavra
// genérica de nome de clube.
const FOREIGN_STOPWORDS = new Set(
  (
    "de da do das dos del la las los el the and y club clube atletico " +
    "athletic fc cf sc ca cd cs ac afc deportivo deportiva deportes " +
    "sociedad sporting futbol football"
  ).split(" ")
);

// Tokens que identificam o clube mas também são palavra comum em português ("o real",
// "seleção nacional", "Lima" sobrenome): só em forma de clube, como os ambíguos da
// tabela.
const FOREIGN_COMMON_WORDS = new Set(
  (
    "real nacional union central universidad catolica santa san sao city " +
    "united junior juniors lima independiente boca liga plata"
  ).split(" ")
);

/**
 * Padrões que contam como "o texto cita este time" (sobre texto dobrado). Time fora da
 * tabela (o estrangeiro da Libertadores): o nome inteiro como palavra (cru e
 * normalizado) e cada token distintivo do nome (≥3 letras, sem artigo/sigla de clube):
 * a manchete diz "Flamengo x Estudiantes", "a LDU", "x River", nunca o nome oficial.
 * Token que é palavra comum só casa em forma de clube.
 */
export function mentionTermsFor(name: string): readonly RegExp[] {
  const source = resolveTeamSources(name);
  if (source) return source.mentions;
  const folded = foldText(name).replace(/\s+/g, " ").trim();
  const forms = new Set(
    [folded, normalizeTeamName(name)].filter((f) => f.length >= 3)
  );
  const tokens = new Set(
    folded
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !FOREIGN_STOPWORDS.has(t))
  );
  return [
    ...[...forms].map(literalTerm),
    ...[...tokens].flatMap((t) =>
      FOREIGN_COMMON_WORDS.has(t) ? clubForms(t) : [word(t)]
    ),
  ];
}

export function textMentionsTeam(text: string, name: string): boolean {
  const folded = foldText(text);
  return mentionTermsFor(name).some((re) => re.test(folded));
}

/** `true` se o time tem padrões próprios na tabela (o adversário foi reconhecido). */
export function isKnownTeam(name: string): boolean {
  return resolveTeamSources(name) !== null;
}

// "Estudiantes de La Plata" → "estudiantes-de-la-plata" (forma de slug do ge).
function slugify(s: string): string {
  return foldText(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slug do time na URL das matérias do ge ("palmeiras-x-flamengo-onde-assistir…"): o da
 * tabela ou, fora dela, o nome normalizado em forma de slug. Só pra casar o confronto
 * no link; nunca vira chave.
 */
export function teamUrlSlug(name: string): string {
  return resolveTeamSources(name)?.geSlug ?? slugify(normalizeTeamName(name));
}

/**
 * Padrão do confronto no caminho do link (`<mandante>-x-<visitante>` ou o inverso),
 * com borda de segmento dos dois lados: "palmeiras-x-flamengo-onde-assistir" casa,
 * "nao-palmeiras-x-flamengoxyz" não.
 */
export function matchupSlugPattern(home: string, away: string): RegExp | null {
  const h = escapeRegex(teamUrlSlug(home));
  const a = escapeRegex(teamUrlSlug(away));
  if (h === "" || a === "") return null;
  return new RegExp(String.raw`[/-](?:${h}-x-${a}|${a}-x-${h})(?:[-./]|$)`);
}

/**
 * Nome curto SÓ pra consulta da web search (ver o cabeçalho: fronteira do #578). Time
 * fora da tabela segue com o nome que veio.
 */
export function newsShortName(name: string): string {
  return resolveTeamSources(name)?.shortName ?? name;
}
