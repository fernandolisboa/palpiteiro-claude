// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";

import {
  TEAM_NEWS_SOURCES,
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
  it("cai no nome inteiro como palavra", () => {
    const terms = mentionTermsFor("Real Madrid CF");
    expect(terms.some((re) => re.test("real madrid vence"))).toBe(true);
    expect(terms.some((re) => re.test("real vence"))).toBe(false);
  });
});
