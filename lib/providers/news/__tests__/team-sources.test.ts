// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";

import {
  TEAM_NEWS_SOURCES,
  matchupSlugPattern,
  mentionTermsFor,
  newsShortName,
  resolveTeamSources,
  textMentionsTeam,
} from "../team-sources";

describe("resolveTeamSources", () => {
  it("todo time canônico do Brasileirão resolve pra um slug do ge", () => {
    const missing = CANONICAL_TEAMS.brasileirao_a.filter(
      (t) => !resolveTeamSources(t)
    );
    expect(missing).toEqual([]);
  });

  it("nomes nus (Libertadores) e grafias da API-Football resolvem pro mesmo time", () => {
    expect(resolveTeamSources("Palmeiras")?.geSlug).toBe("palmeiras");
    expect(resolveTeamSources("SE Palmeiras")?.geSlug).toBe("palmeiras");
    expect(resolveTeamSources("Flamengo")?.geSlug).toBe("flamengo");
    expect(resolveTeamSources("Atletico-MG")?.geSlug).toBe("atletico-mg");
    expect(resolveTeamSources("CA Mineiro")?.geSlug).toBe("atletico-mg");
    expect(resolveTeamSources("Athletico-PR")?.geSlug).toBe("athletico-pr");
    expect(resolveTeamSources("CA Paranaense")?.geSlug).toBe("athletico-pr");
    expect(resolveTeamSources("Sao Paulo")?.geSlug).toBe("sao-paulo");
    expect(resolveTeamSources("Fortaleza EC")?.geSlug).toBe("fortaleza");
    expect(resolveTeamSources("Grêmio")?.geSlug).toBe("gremio");
  });

  it("times de fora (e homônimos estrangeiros) → null", () => {
    for (const name of [
      "Arsenal FC",
      "FC Internazionale Milano",
      "Club Atlético de Madrid",
      "Estudiantes de La Plata",
      "Athletic Club",
      "Real Madrid CF",
    ]) {
      expect(resolveTeamSources(name), name).toBeNull();
    }
  });

  it("slugs únicos, e nenhum nome normalizado aponta pra dois times", () => {
    const slugs = TEAM_NEWS_SOURCES.map((s) => s.geSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const owner = new Map<string, string>();
    for (const source of TEAM_NEWS_SOURCES) {
      for (const name of source.names) {
        const key = normalizeTeamName(name);
        const prev = owner.get(key);
        expect(
          prev === undefined || prev === source.geSlug,
          `${name} → ${prev}`
        ).toBe(true);
        owner.set(key, source.geSlug);
      }
    }
  });
});

describe("newsShortName (só pra consulta da web search)", () => {
  it("nome curto pros times da tabela; o resto segue como veio", () => {
    expect(newsShortName("SE Palmeiras")).toBe("Palmeiras");
    expect(newsShortName("CA Mineiro")).toBe("Atlético-MG");
    expect(newsShortName("Arsenal FC")).toBe("Arsenal FC");
  });
});

describe("textMentionsTeam — nomes inequívocos", () => {
  it("casa como palavra, sem acento e sem caixa", () => {
    expect(
      textMentionsTeam("Palmeiras x Flamengo: onde assistir", "SE Palmeiras")
    ).toBe(true);
    expect(textMentionsTeam("O GRÊMIO vence fora", "Grêmio FBPA")).toBe(true);
    expect(textMentionsTeam("Grêmio Novorizontino sobe", "Grêmio FBPA")).toBe(
      false
    );
    expect(
      textMentionsTeam("Botafogo-SP empata na Série B", "Botafogo FR")
    ).toBe(false);
    expect(textMentionsTeam("Botafogo vence o clássico", "Botafogo FR")).toBe(
      true
    );
  });

  it("Atlético sozinho não decide entre MG, PR e Madrid", () => {
    expect(textMentionsTeam("Atlético vence fora", "CA Mineiro")).toBe(false);
    expect(textMentionsTeam("Atlético-MG vence fora", "CA Mineiro")).toBe(true);
    expect(textMentionsTeam("Galo vence fora", "CA Mineiro")).toBe(true);
    expect(textMentionsTeam("Atlético de Madrid vence", "CA Mineiro")).toBe(
      false
    );
    expect(
      textMentionsTeam("Athletico vence o Flamengo", "CA Paranaense")
    ).toBe(true);
    expect(textMentionsTeam("Atlético-PR vence", "CA Paranaense")).toBe(true);
    expect(textMentionsTeam("Atlético-MG vence", "CA Paranaense")).toBe(false);
  });
});

describe("textMentionsTeam — nomes ambíguos exigem forma de clube", () => {
  it("Vitória: palavra comum", () => {
    const t = "EC Vitória";
    expect(textMentionsTeam("Flamengo busca a vitória fora de casa", t)).toBe(
      false
    );
    expect(textMentionsTeam("Rossi celebra vitória do Flamengo", t)).toBe(
      false
    );
    expect(textMentionsTeam("Flamengo encara o Vitória no sábado", t)).toBe(
      true
    );
    expect(textMentionsTeam("Desfalques do Vitória para o jogo", t)).toBe(true);
    expect(textMentionsTeam("Flamengo x Vitória: onde assistir", t)).toBe(true);
    expect(textMentionsTeam("Vitória x Flamengo: escalações", t)).toBe(true);
    expect(textMentionsTeam("Técnico do Vitória-BA fala", t)).toBe(true);
  });

  it("São Paulo: cidade e estado", () => {
    const t = "São Paulo FC";
    expect(
      textMentionsTeam("Campeão em São Paulo? Flamengo tenta título", t)
    ).toBe(false);
    expect(textMentionsTeam("Flamengo chega a São Paulo e é recebido", t)).toBe(
      false
    );
    expect(
      textMentionsTeam("Flamengo enfrenta o São Paulo no Morumbis", t)
    ).toBe(true);
    expect(textMentionsTeam("Flamengo x São Paulo: onde assistir", t)).toBe(
      true
    );
  });

  it("Bahia e Ceará: estados", () => {
    expect(textMentionsTeam("Torneio de base na Bahia", "EC Bahia")).toBe(
      false
    );
    expect(textMentionsTeam("Jogador da Bahia chega", "EC Bahia")).toBe(false);
    expect(textMentionsTeam("Flamengo pega o Bahia em casa", "EC Bahia")).toBe(
      true
    );
    expect(
      textMentionsTeam("Flamengo faz pré-temporada no Ceará", "Ceará SC")
    ).toBe(false);
    expect(textMentionsTeam("Turismo do Ceará cresce", "Ceará SC")).toBe(false);
    expect(textMentionsTeam("Flamengo x Ceará: escalações", "Ceará SC")).toBe(
      true
    );
    expect(textMentionsTeam("Flamengo joga contra o Ceará", "Ceará SC")).toBe(
      true
    );
  });

  it("Santos: sobrenome", () => {
    const t = "Santos FC";
    expect(
      textMentionsTeam("Futuro de Douglas Santos, lateral da Seleção", t)
    ).toBe(false);
    expect(textMentionsTeam("Dia de todos os santos", t)).toBe(false);
    expect(textMentionsTeam("Flamengo recebe o Santos no Maracanã", t)).toBe(
      true
    );
    expect(textMentionsTeam("Santos x Flamengo: horário", t)).toBe(true);
  });

  it("Sport: palavra inglesa", () => {
    const t = "Sport Recife";
    expect(textMentionsTeam("Assista no sportv e no ge", t)).toBe(false);
    expect(textMentionsTeam("Flamengo enfrenta o Sport na Ilha", t)).toBe(true);
    expect(textMentionsTeam("Sport x Flamengo: escalações", t)).toBe(true);
  });

  it("Internacional/Inter: adjetivo e homônimos", () => {
    const t = "SC Internacional";
    expect(
      textMentionsTeam("Ex-Flamengo brilha no futebol internacional", t)
    ).toBe(false);
    expect(textMentionsTeam("Data Fifa internacional", t)).toBe(false);
    expect(textMentionsTeam("Ex-jogador do Inter de Milão comenta", t)).toBe(
      false
    );
    expect(textMentionsTeam("Flamengo encara o Inter no Beira-Rio", t)).toBe(
      true
    );
    expect(textMentionsTeam("Flamengo x Internacional: onde assistir", t)).toBe(
      true
    );
    expect(textMentionsTeam("Inter x Flamengo: escalações", t)).toBe(true);
  });

  it("Fortaleza, Juventude e Remo: cidade, palavra e esporte", () => {
    expect(
      textMentionsTeam("Flamengo treina em Fortaleza", "Fortaleza EC")
    ).toBe(false);
    expect(
      textMentionsTeam("Flamengo enfrenta o Fortaleza", "Fortaleza EC")
    ).toBe(true);
    expect(
      textMentionsTeam("A juventude do elenco chama atenção", "EC Juventude")
    ).toBe(false);
    expect(
      textMentionsTeam("Flamengo visita o Juventude", "EC Juventude")
    ).toBe(true);
    expect(
      textMentionsTeam("O remo brasileiro ganha medalha", "Clube do Remo")
    ).toBe(false);
    expect(
      textMentionsTeam("Remo x Flamengo: escalações", "Clube do Remo")
    ).toBe(true);
    expect(
      textMentionsTeam("Clube do Remo anuncia técnico", "Clube do Remo")
    ).toBe(true);
  });
});

describe("mentionTermsFor — time fora da tabela", () => {
  it("nome inteiro como palavra; token que é palavra comum só em forma de clube", () => {
    const terms = mentionTermsFor("Real Madrid CF");
    expect(terms.some((re) => re.test("real madrid vence"))).toBe(true);
    expect(terms.some((re) => re.test("madrid vence"))).toBe(true);
    // "real" é palavra comum (moeda, adjetivo).
    expect(terms.some((re) => re.test("o preco real do ingresso"))).toBe(false);
    expect(terms.some((re) => re.test("flamengo tem gasto real menor"))).toBe(
      false
    );
    expect(terms.some((re) => re.test("flamengo x real"))).toBe(true);
  });

  it("estrangeiro da Libertadores casa pelo token distintivo, como a manchete escreve", () => {
    expect(
      textMentionsTeam(
        "Flamengo x Estudiantes: onde assistir",
        "Estudiantes de La Plata"
      )
    ).toBe(true);
    expect(
      textMentionsTeam(
        "Palmeiras visita a LDU na altitude de Quito",
        "LDU de Quito"
      )
    ).toBe(true);
    expect(
      textMentionsTeam(
        "Escalação do Flamengo para encarar a LDU",
        "LDU de Quito"
      )
    ).toBe(true);
    expect(
      textMentionsTeam("Palmeiras x River: escalações", "River Plate")
    ).toBe(true);
    expect(
      textMentionsTeam("Flamengo impõe virada ao Boca Juniors", "Boca Juniors")
    ).toBe(true);
    // Sigla com ponto: o termo não termina em \b (nunca casaria depois do ponto).
    expect(
      textMentionsTeam(
        "Flamengo pega o Estudiantes L.P. hoje",
        "Estudiantes L.P."
      )
    ).toBe(true);
    // Artigo/preposição/sigla de clube não casam sozinhos.
    expect(
      textMentionsTeam("A escalação de la para cá", "Estudiantes de La Plata")
    ).toBe(false);
    expect(
      textMentionsTeam("Flamengo treina no CT", "Club Atlético River Plate")
    ).toBe(false);
  });
});

describe("textMentionsTeam — forma de jogo (verbo) pra nome ambíguo", () => {
  it("verbo de jogo antes do nome", () => {
    expect(
      textMentionsTeam("Flamengo vence Remo no Mangueirão", "Clube do Remo")
    ).toBe(true);
    expect(
      textMentionsTeam(
        "Corinthians recebe São Paulo em Itaquera",
        "São Paulo FC"
      )
    ).toBe(true);
    expect(
      textMentionsTeam("Flamengo goleia Vitória no Maracanã", "EC Vitória")
    ).toBe(true);
    expect(textMentionsTeam("Flamengo perde para Bahia fora", "EC Bahia")).toBe(
      true
    );
    expect(textMentionsTeam("Fortaleza empata com Ceará", "Ceará SC")).toBe(
      true
    );
  });

  it("nome como sujeito só no começo da manchete ou da oração", () => {
    expect(
      textMentionsTeam("Santos empata com Palmeiras na Vila", "Santos FC")
    ).toBe(true);
    expect(
      textMentionsTeam(
        "Classificação do segundo turno: Santos empata com Palmeiras",
        "Santos FC"
      )
    ).toBe(true);
    expect(
      textMentionsTeam(
        "Douglas Santos vence prêmio de melhor lateral",
        "Santos FC"
      )
    ).toBe(false);
    // "vitória" seguida de verbo de jogo no meio da frase segue sendo palavra comum.
    expect(
      textMentionsTeam(
        "Flamengo celebra vitória e encara maratona",
        "EC Vitória"
      )
    ).toBe(false);
  });
});

describe("matchupSlugPattern — confronto no link do ge", () => {
  it("casa os dois sentidos com borda de segmento", () => {
    const re = matchupSlugPattern("SE Palmeiras", "CR Flamengo");
    expect(
      re?.test(
        "/futebol/noticia/2026/11/21/palmeiras-x-flamengo-onde-assistir.ghtml"
      )
    ).toBe(true);
    expect(re?.test("/futebol/noticia/flamengo-x-palmeiras.ghtml")).toBe(true);
    expect(re?.test("/futebol/noticia/palmeiras-x-flamengoxyz.ghtml")).toBe(
      false
    );
    const sp = matchupSlugPattern("SC Corinthians Paulista", "São Paulo FC");
    expect(
      sp?.test("/futebol/noticia/corinthians-x-sao-paulo-ao-vivo.ghtml")
    ).toBe(true);
    // Fora da tabela: nome normalizado como slug.
    const est = matchupSlugPattern("Flamengo", "Estudiantes de La Plata");
    expect(est?.source).toContain("estudiantes");
  });
});
