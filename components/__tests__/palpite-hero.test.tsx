import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// O HERO roda pela rota de streaming (ADR 0064) e faz router.refresh() no fim.
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh }) }));

// PalpiteHero usa useActionState(runPalpiteHero) — mock leve pra não puxar o server
// action server-only no env de teste. O runPalpiteHero mockado reproduz o roteamento
// por `intent` do real, então os testes interativos provam qual botão manda o quê.
vi.mock("@/app/actions/predictions", () => {
  const analyzeBestBet = vi.fn();
  const generatePalpiteFromAnalyses = vi.fn();
  const runPalpiteHero = vi.fn((_prev: unknown, formData: FormData) => {
    const intent = formData.get("intent");
    if (intent === "palpite") return generatePalpiteFromAnalyses(null, formData);
    if (intent === "analysis") return analyzeBestBet(null, formData);
    return Promise.resolve({ ok: false, error: "Ação inválida." });
  });
  return { analyzeBestBet, generatePalpiteFromAnalyses, runPalpiteHero };
});

// shareSet/unshareSet são "use server" — mock leve pra não puxar o server action no env de
// teste. O render estático nunca dispara o onClick; o teste interativo do kill-switch (#438)
// controla unshareSet.
vi.mock("@/app/actions/share", () => ({
  shareSet: vi.fn(),
  unshareSet: vi.fn(),
}));

import {
  analyzeBestBet,
  generatePalpiteFromAnalyses,
  runPalpiteHero,
} from "@/app/actions/predictions";
import { unshareSet } from "@/app/actions/share";
import { PalpiteHero } from "@/components/palpites/palpite-hero";
import type { ProgressMascot } from "@/lib/brand/progress-mascot";
import { PALPITE_RUN_ENDPOINT } from "@/components/palpites/use-palpite-run";
import { resetRunStoreForTests } from "@/components/palpites/palpite-run-store";
import {
  encodeStreamMessage,
  toHeroRunOutcome,
  type RunSnapshot,
  type StreamMessage,
} from "@/lib/ai/progress/protocol";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import type { MatchUnavailableReason } from "@/lib/view/match-availability";
import {
  PALPITE_DISCLAIMER,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";

const MATCH_A = "11111111-1111-1111-1111-111111111111";
const MATCH_B = "22222222-2222-2222-2222-222222222222";

function snapshot(runId: string): RunSnapshot {
  return {
    runId,
    intent: "analysis",
    live: false,
    startedAt: Date.now(),
    status: "running",
    steps: [],
    outcome: null,
  };
}

// A rota de streaming nos testes: roda a action mockada com o MESMO FormData e devolve
// o resultado em NDJSON, como app/api/palpite/run faria (as etapas vêm de `extra`).
function streamingFetch(extra: StreamMessage[] = []) {
  return vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(PALPITE_RUN_ENDPOINT);
    const result = await runPalpiteHero(null, init.body as FormData);
    const body = [...extra, { t: "result", outcome: toHeroRunOutcome(result) } as const]
      .map(encodeStreamMessage)
      .join("");
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  });
}

beforeEach(() => {
  nav.refresh.mockClear();
  // Os runs moram num store por jogo (fora do componente): cada caso começa limpo, e o
  // acompanhamento pelo marcador lê sem esperar.
  resetRunStoreForTests({ pollMs: 0 });
  vi.stubGlobal("fetch", streamingFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// O run passa por fetch + leitura do stream: deixa as promessas assentarem dentro do act.
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}

// Manchete POVOADA de propósito (com confiança qualitativa + placar) — a asserção-chave
// é que NENHUM número de valor cruza pra UI. Espelha o POPULATED do guard de dado.
const POPULATED: PalpiteHeadlineView = {
  verdict: "Pra mim vai dar Palmeiras",
  probableScore: { home: 2, away: 1 },
  confidence: "media",
  narrative:
    "O Verdão vem melhor em casa e tende a controlar o jogo do meio pra frente.",
  citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
  badge: null,
  dimensions: [],
};

// Firewall do HERO (PLAN §5): reusa o MESMO guard de DADO (containsValueLanguage, os 13
// padrões do ADR 0030 §3 com word-boundaries — edge/EV/stake/odd/yield/unidades/lucro/
// retorno/cotação/valor esperado/R$) como FONTE ÚNICA: a UI passa a casar exatamente o
// que a camada de dado barra (o \bedge\b já pega até uma classe `edge-*`). Soma a regra
// HERO-específica "sem %" (confiança é PALAVRA, nunca percentual; o guard de dado não bane
// % de propósito). Um vazamento — número de valor OU % — falha aqui.
function leaksValue(html: string): boolean {
  return containsValueLanguage(html) || /%/.test(html);
}

function render(props: Partial<Parameters<typeof PalpiteHero>[0]> = {}): string {
  return renderToStaticMarkup(
    <PalpiteHero
      heroPalpite={POPULATED}
      matchId="11111111-1111-1111-1111-111111111111"
      unavailable={null}
      fanOutEnabled
      finalScore={null}
      setId="22222222-2222-2222-2222-222222222222"
      sharedAt={null}
      hasAnalyses={false}
      contextEnabled={false}
      {...props}
      // Capacidade (ADR 0060): nos testes de antes, analisável = pré-jogo.
      analyzable={props.analyzable ?? (props.unavailable ?? null) === null}
    />,
  );
}

describe("PalpiteHero — firewall de valor (ADR 0030 §3, inviolável)", () => {
  it("populated: ZERO número/termo de valor no DOM e nenhuma classe edge-*", () => {
    const html = render();
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("populated settled (won): firewall continua limpo mesmo com recibo de placar real", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "won" },
      finalScore: { home: 2, away: 1 },
    });
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("empty + CTA: a casca vazia também é firewall-limpa", () => {
    const html = render({ heroPalpite: null });
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });
});

describe("PalpiteHero — confiança = palavra-chip (sem dígito/%/meter)", () => {
  it("rende a PALAVRA da confiança e nenhum dígito/% de confiança", () => {
    const html = render();
    expect(html).toContain("confiança média");
    // aria-label repete a palavra inteira (a11y).
    expect(html).toContain('aria-label="confiança média"');
    // Sem percentual nem meter/pip.
    expect(html).not.toMatch(/%/);
    expect(html).not.toContain("role=\"progressbar\"");
  });

  it.each([
    ["baixa" as const, "confiança baixa"],
    ["media" as const, "confiança média"],
    ["alta" as const, "confiança alta"],
  ])("confiança %s → palavra '%s'", (confidence, label) => {
    const html = render({ heroPalpite: { ...POPULATED, confidence } });
    expect(html).toContain(label);
  });

  it("#649: sem confiança do motor (null) → sem chip", () => {
    const html = render({ heroPalpite: { ...POPULATED, confidence: null } });
    expect(html).not.toContain("confiança");
    expect(html).toContain("provável");
  });
});

describe("PalpiteHero — settled honesty (palavra, nunca só cor; a11y)", () => {
  it("won → 'acertou' + token form-win, SEM 'errou'", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "won" },
      finalScore: { home: 2, away: 1 },
    });
    expect(html).toContain("Acertou");
    expect(html).toContain("form-win");
    expect(html).not.toContain("Errou");
  });

  it("lost → 'errou' + token form-loss, SEM 'acertou'", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "lost" },
      finalScore: { home: 0, away: 3 },
    });
    expect(html).toContain("Errou");
    expect(html).toContain("form-loss");
    expect(html).not.toContain("Acertou");
  });

  it("settled mostra o recibo: placar provável + placar real", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "won" },
      finalScore: { home: 2, away: 1 },
    });
    expect(html).toContain("provável");
    expect(html).toContain("placar real");
  });
});

describe("PalpiteHero — ficha de dimensões (#354, major D)", () => {
  it("0 dimensões → scorecard ESCONDIDO inteiro (sem 'e ainda')", () => {
    const html = render({ heroPalpite: { ...POPULATED, dimensions: [] } });
    expect(html).not.toContain("e ainda");
  });

  it("1–2 dimensões → renderiza os labels + badges, firewall limpo", () => {
    const html = render({
      heroPalpite: {
        ...POPULATED,
        dimensions: [
          { label: "Mandante ganha por 2+", badge: null },
          { label: "1º tempo: 1–0", badge: "won" },
        ],
      },
    });
    expect(html).toContain("e ainda");
    expect(html).toContain("Mandante ganha por 2+");
    expect(html).toContain("1º tempo: 1–0");
    expect(html).toContain("Em aberto"); // pending badge
    expect(html).toContain("Acertou"); // won badge
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("várias dimensões settled + pending misturadas → firewall continua limpo", () => {
    const html = render({
      heroPalpite: {
        ...POPULATED,
        dimensions: [
          { label: "Mandante ganha por 2+", badge: "won" },
          { label: "Mandante não sofre gol", badge: "lost" },
          { label: "1º tempo: 1–0", badge: null },
          { label: "Mandante marca primeiro", badge: "won" },
        ],
      },
    });
    expect(html).toContain("Mandante não sofre gol");
    expect(html).toContain("Mandante marca primeiro");
    expect(html).toContain("Acertou");
    expect(html).toContain("Errou");
    expect(html).toContain("Em aberto");
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });
});

describe("PalpiteHero — fontes citadas (#378, ADR 0032)", () => {
  const SOURCES = [
    { title: "Palmeiras confirma escalação titular", url: "https://ge.globo.com/a" },
    { title: "Verdão chega embalado pra decisão", url: "https://espn.com.br/b" },
  ];

  it("sem sources → seção escondida (sem 'o palpite leu'), mas disclaimer continua presente", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: undefined } });
    expect(html).not.toContain("o palpite leu");
    // O disclaimer regulatório (último filho) NÃO depende das fontes.
    expect(html).toContain(PALPITE_DISCLAIMER);
  });

  it("com sources → títulos viram links reais (href, nova aba, rel seguro, texto do título)", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: SOURCES } });
    expect(html).toContain("o palpite leu");
    for (const s of SOURCES) {
      expect(html).toContain(`href="${s.url}"`);
      expect(html).toContain(s.title);
    }
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("com sources → firewall continua limpo (sem número/termo de valor, sem classe edge-*)", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: SOURCES } });
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("disclaimer continua firewall-clean mesmo com as fontes presentes", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: SOURCES } });
    expect(html).toContain(PALPITE_DISCLAIMER);
    expect(containsValueLanguage(PALPITE_DISCLAIMER)).toBe(false);
  });
});

describe("PalpiteHero — estados empty/CTA/kill-switch/encerrado", () => {
  it("sem palpite + analyzable + flag on → CTA 'Analisar com IA' + teaser", () => {
    const html = render({ heroPalpite: null });
    expect(html).toContain("Analisar com IA");
    expect(html).toContain("E aí, quem leva esse jogo?");
  });

  it("sem palpite + analyzable + flag OFF → aviso suave, SEM botão de análise", () => {
    const html = render({ heroPalpite: null, fanOutEnabled: false });
    expect(html).toContain("temporariamente indisponível");
    expect(html).not.toContain("Analisar com IA");
  });

  it.each([
    ["finished", "Jogo encerrado, sem palpite por aqui."],
    ["cancelled", "Jogo cancelado, sem palpite por aqui."],
    ["started", "Jogo já começou, sem palpite por aqui."],
    ["live", "Jogo em andamento, sem palpite por aqui."],
    ["postponed", "Jogo adiado, sem palpite por enquanto."],
  ] as const)(
    "sem palpite + não analisável (%s) → aviso do motivo, sem CTA",
    (reason, copy) => {
      const html = render({ heroPalpite: null, unavailable: reason });
      expect(html).toContain(copy);
      expect(html).not.toContain("Analisar com IA");
    },
  );

  it.each(["started", "live", "postponed"] as const)(
    "jogo %s nunca diz 'encerrado'",
    (reason) => {
      expect(render({ heroPalpite: null, unavailable: reason })).not.toContain(
        "encerrado",
      );
    },
  );

  it("populated + analyzable → botão ghost 'Analisar de novo'", () => {
    const html = render();
    expect(html).toContain("Analisar de novo");
  });

  it("populated kicker 'Palpite da IA' presente", () => {
    const html = render();
    expect(html).toContain("Palpite da IA");
  });
});

describe("PalpiteHero — ShareButton + kill-switch (ADR 0035 §3e / #438)", () => {
  it("não-compartilhado → 'Compartilhar', SEM 'Parar de compartilhar'", () => {
    const html = render({ sharedAt: null });
    expect(html).toContain("Compartilhar");
    expect(html).not.toContain("Parar de compartilhar");
  });

  it("já compartilhado → 'Copiar link' + 'Parar de compartilhar'", () => {
    const html = render({ sharedAt: new Date("2026-06-01T00:00:00Z") });
    expect(html).toContain("Copiar link");
    expect(html).toContain("Parar de compartilhar");
  });

  it("clicar 'Parar de compartilhar' chama unshareSet e volta ao estado não-compartilhado", async () => {
    vi.mocked(unshareSet).mockResolvedValue({ ok: true });
    // React 19: sinaliza ambiente de act() pro createRoot (senão warning no console).
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PalpiteHero
          contextEnabled={false}
          heroPalpite={POPULATED}
          matchId="11111111-1111-1111-1111-111111111111"
          unavailable={null}
          analyzable
          fanOutEnabled
          finalScore={null}
          setId="22222222-2222-2222-2222-222222222222"
          sharedAt={new Date("2026-06-01T00:00:00Z")}
          hasAnalyses={false}
        />,
      );
    });

    const stop = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Parar de compartilhar"),
    );
    expect(stop).toBeDefined();
    await act(async () => {
      stop!.click();
    });

    expect(unshareSet).toHaveBeenCalledWith(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(container.textContent).not.toContain("Parar de compartilhar");
    expect(container.textContent).not.toContain("Copiar link");
    expect(container.textContent).toContain("Compartilhar");

    await act(async () => root.unmount());
    container.remove();
  });
});

describe("PalpiteHero — análises saíram mas o palpite não (regressão)", () => {
  // Antes: analyzeBestBet voltava {ok:true, palpite:null} quando a síntese falhava, e o
  // HERO voltava mudo pro "E aí, quem leva esse jogo?" enquanto o detalhe por mercado
  // aparecia abaixo. Agora o aviso da action aparece no card.
  async function submitWith(
    result: Awaited<ReturnType<typeof analyzeBestBet>>,
    heroPalpite: PalpiteHeadlineView | null,
    after?: { unavailable?: MatchUnavailableReason | null; setId?: string | null },
  ) {
    vi.mocked(analyzeBestBet).mockResolvedValue(result);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PalpiteHero
          contextEnabled={false}
          heroPalpite={heroPalpite}
          matchId="11111111-1111-1111-1111-111111111111"
          unavailable={null}
          analyzable
          fanOutEnabled
          finalScore={null}
          setId={null}
          sharedAt={null}
          hasAnalyses={false}
        />,
      );
    });
    const analyze = container.querySelector<HTMLButtonElement>(
      'button[name="intent"][value="analysis"]',
    )!;
    await act(async () => {
      container.querySelector("form")!.requestSubmit(analyze);
      await settle();
    });
    // Re-render como o revalidate faria (props do servidor depois do run).
    if (after) {
      await act(async () => {
        root.render(
          <PalpiteHero
            contextEnabled={false}
            heroPalpite={heroPalpite}
            matchId="11111111-1111-1111-1111-111111111111"
            unavailable={after.unavailable ?? null}
            analyzable={(after.unavailable ?? null) === null}
            fanOutEnabled
            finalScore={null}
            setId={after.setId ?? null}
            sharedAt={null}
            hasAnalyses={false}
          />,
        );
      });
    }
    const text = container.textContent ?? "";
    await act(async () => root.unmount());
    container.remove();
    return text;
  }

  const VIEW = {
    entries: [],
    errors: [],
  } as unknown as Extract<
    Awaited<ReturnType<typeof analyzeBestBet>>,
    { ok: true }
  >["view"];
  const MESSAGE =
    "As análises por mercado ficaram prontas, mas o palpite não saiu desta vez. Tente de novo pelo botão de gerar só o palpite, que usa as análises já salvas sem refazê-las.";

  it("sem palpite anterior → aviso no card vazio, com a CTA pra tentar de novo", async () => {
    const text = await submitWith(
      { ok: true, view: VIEW, palpite: null, palpiteError: MESSAGE },
      null,
    );
    expect(analyzeBestBet).toHaveBeenCalled();
    expect(vi.mocked(analyzeBestBet).mock.calls.at(-1)![1].get("intent")).toBe(
      "analysis",
    );
    expect(text).toContain("Não rolou dessa vez");
    expect(text).toContain(MESSAGE);
    expect(text).toContain("Analisar com IA");
  });

  it("com palpite anterior → aviso acima da manchete antiga", async () => {
    const text = await submitWith(
      { ok: true, view: VIEW, palpite: null, palpiteError: MESSAGE },
      POPULATED,
    );
    expect(text).toContain(MESSAGE);
    expect(text).toContain(POPULATED.verdict);
  });

  it("jogo apitou durante o run → o aviso aparece no card de não-analisável", async () => {
    const text = await submitWith(
      { ok: true, view: VIEW, palpite: null, palpiteError: MESSAGE },
      null,
      { unavailable: "live" },
    );
    expect(text).toContain(MESSAGE);
    expect(text).not.toContain("Analisar com IA");
  });

  it("outro set chega depois (outra aba) → o aviso antigo some", async () => {
    const text = await submitWith(
      { ok: true, view: VIEW, palpite: null, palpiteError: MESSAGE },
      POPULATED,
      { setId: "33333333-3333-3333-3333-333333333333" },
    );
    expect(text).not.toContain(MESSAGE);
    expect(text).toContain(POPULATED.verdict);
  });

  it("síntese ok → nenhum aviso", async () => {
    const text = await submitWith(
      { ok: true, view: VIEW, palpite: POPULATED },
      POPULATED,
    );
    expect(text).not.toContain("Não rolou dessa vez");
  });
});

describe("PalpiteHero — gerar só o palpite (síntese sobre as análises salvas)", () => {
  it("sem análises salvas → só 'Analisar com IA'", () => {
    const html = render({ heroPalpite: null, hasAnalyses: false });
    expect(html).toContain("Analisar com IA");
    expect(html).not.toContain("Gerar só o palpite");
  });

  it("com análises salvas → 'Analisar com IA' + 'Gerar só o palpite'", () => {
    const html = render({ heroPalpite: null, hasAnalyses: true });
    expect(html).toContain("Analisar com IA");
    expect(html).toContain("Gerar só o palpite");
  });

  it("com palpite + análises → 'Analisar de novo' + 'Refazer só o palpite'", () => {
    const html = render({ hasAnalyses: true });
    expect(html).toContain("Analisar de novo");
    expect(html).toContain("Refazer só o palpite");
  });

  it("flag off ou jogo não analisável → sem o botão", () => {
    expect(
      render({ heroPalpite: null, hasAnalyses: true, fanOutEnabled: false }),
    ).not.toContain("Gerar só o palpite");
    expect(render({ hasAnalyses: true, unavailable: "finished" })).not.toContain(
      "Refazer só o palpite",
    );
  });

  it("clicar 'Gerar só o palpite' chama só a síntese, não o run completo", async () => {
    vi.mocked(analyzeBestBet).mockClear();
    vi.mocked(generatePalpiteFromAnalyses).mockResolvedValue({
      ok: true,
      palpite: null,
      palpiteError: "O palpite não saiu.",
    });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PalpiteHero
          contextEnabled={false}
          heroPalpite={null}
          matchId="11111111-1111-1111-1111-111111111111"
          unavailable={null}
          analyzable
          fanOutEnabled
          finalScore={null}
          setId={null}
          sharedAt={null}
          hasAnalyses
        />,
      );
    });
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Gerar só o palpite"),
    )!;
    await act(async () => {
      container.querySelector("form")!.requestSubmit(button);
      await settle();
    });
    expect(generatePalpiteFromAnalyses).toHaveBeenCalledTimes(1);
    const fd = vi.mocked(generatePalpiteFromAnalyses).mock.calls[0][1];
    expect(fd.get("matchId")).toBe("11111111-1111-1111-1111-111111111111");
    expect(analyzeBestBet).not.toHaveBeenCalled();
    expect(container.textContent).toContain("O palpite não saiu.");
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("PalpiteHero — Contexto extra (#565)", () => {
  const TEXT = "O mandante está sem o centroavante titular.";

  it("o campo só aparece com o contexto ligado, jogo analisável e o fan-out ligado", () => {
    for (const heroPalpite of [null, POPULATED]) {
      expect(render({ heroPalpite, contextEnabled: true })).toContain(
        "Contexto extra (opcional)",
      );
      expect(render({ heroPalpite, contextEnabled: false })).not.toContain(
        "Contexto extra",
      );
      expect(
        render({ heroPalpite, contextEnabled: true, fanOutEnabled: false }),
      ).not.toContain("Contexto extra");
      expect(
        render({ heroPalpite, contextEnabled: true, unavailable: "live" }),
      ).not.toContain("Contexto extra");
    }
  });

  it("textarea userContext com teto de 1.000, contador e a dica; firewall limpo", () => {
    const html = render({ heroPalpite: null, contextEnabled: true });
    expect(html).toMatch(/<textarea[^>]*name="userContext"/);
    expect(html).toMatch(/<textarea[^>]*maxLength="1000"/i);
    expect(html).toContain("0/1000");
    expect(html).toContain("Não escreva dados pessoais.");
    expect(leaksValue(render({ contextEnabled: true }))).toBe(false);
    expect(leaksValue(html)).toBe(false);
  });

  async function mount() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PalpiteHero
          contextEnabled
          heroPalpite={POPULATED}
          matchId="11111111-1111-1111-1111-111111111111"
          unavailable={null}
          analyzable
          fanOutEnabled
          finalScore={null}
          setId={null}
          sharedAt={null}
          hasAnalyses={false}
        />,
      );
    });
    const textarea = () =>
      container.querySelector<HTMLTextAreaElement>('textarea[name="userContext"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea(), TEXT);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = async () => {
      const analyze = container.querySelector<HTMLButtonElement>(
        'button[name="intent"][value="analysis"]',
      )!;
      await act(async () => {
        container.querySelector("form")!.requestSubmit(analyze);
        await settle();
      });
    };
    const cleanup = async () => {
      await act(async () => root.unmount());
      container.remove();
    };
    return { container, textarea, submit, cleanup };
  }

  it("envio ok: o texto vai no form, o aviso aparece e o campo é limpo", async () => {
    const NOTICE =
      'Conferimos o seu contexto extra e ele entrou na análise. Veja o que entrou em "Ler análise completa".';
    vi.mocked(analyzeBestBet).mockResolvedValue({
      ok: true,
      view: { entries: [], errors: [] } as never,
      palpite: POPULATED,
      contextNotice: NOTICE,
    });
    const h = await mount();
    expect(h.container.textContent).toContain(`${TEXT.length}/1000`);
    await h.submit();
    const fd = vi.mocked(analyzeBestBet).mock.calls.at(-1)![1];
    expect(fd.get("userContext")).toBe(TEXT);
    expect(h.container.textContent).toContain(NOTICE);
    expect(h.textarea().value).toBe("");
    expect(leaksValue(h.container.innerHTML)).toBe(false);
    await h.cleanup();
  });

  it("apagar o texto na edição não fecha o painel", async () => {
    const h = await mount();
    const details = () => h.container.querySelector("details")!;
    await act(async () => {
      details().querySelector("summary")!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(details().open).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(h.textarea(), "");
      h.textarea().dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.textarea().value).toBe("");
    expect(details().open).toBe(true);
    await h.cleanup();
  });

  it("envio ok fecha o painel; o aviso vai pela região viva sempre montada", async () => {
    const NOTICE = "Conferimos o seu contexto extra, mas ele não mudou a análise.";
    vi.mocked(analyzeBestBet).mockResolvedValue({
      ok: true,
      view: { entries: [], errors: [] } as never,
      palpite: POPULATED,
      contextNotice: NOTICE,
    });
    const h = await mount();
    const live = h.container.querySelector('[role="status"]');
    expect(live?.textContent).toBe("");
    await act(async () => {
      h.container.querySelector("summary")!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.container.querySelector("details")!.open).toBe(true);
    await h.submit();
    // O MESMO nó (não remontado) com o texto novo.
    expect(h.container.querySelector('[role="status"]')).toBe(live);
    expect(live?.textContent).toBe(NOTICE);
    expect(h.container.querySelector("details")!.open).toBe(false);
    await h.cleanup();
  });

  it("run que falha: o texto sobrevive ao pending pra tentar de novo", async () => {
    vi.mocked(analyzeBestBet).mockResolvedValue({ ok: false, error: "Falhou." });
    const h = await mount();
    await h.submit();
    expect(h.container.textContent).toContain("Falhou.");
    expect(h.textarea().value).toBe(TEXT);
    await h.cleanup();
  });
});

describe("PalpiteHero — compacto (#576, expanded=false)", () => {
  const FULL: PalpiteHeadlineView = {
    ...POPULATED,
    dimensions: [{ label: "Mandante ganha por 2+", badge: null }],
    sources: [{ title: "Palmeiras confirma escalação titular", url: "https://ge.globo.com/a" }],
  };

  it("narrativa em 2 linhas (texto inteiro no DOM), sem 'a partir de:', ficha e fontes", () => {
    const html = render({ heroPalpite: FULL, expanded: false });
    expect(html).toContain("line-clamp-2");
    expect(html).toContain(POPULATED.narrative);
    expect(html).not.toContain("a partir de:");
    expect(html).not.toContain("e ainda");
    expect(html).not.toContain("o palpite leu");
  });

  it("veredito, placar, confiança, ações e o disclaimer continuam", () => {
    const html = render({ heroPalpite: FULL, expanded: false, hasAnalyses: true });
    expect(html).toContain(POPULATED.verdict);
    expect(html).toContain("confiança média");
    expect(html).toContain("Analisar de novo");
    expect(html).toContain("Refazer só o palpite");
    expect(html).toContain("Compartilhar");
    expect(html).toContain(PALPITE_DISCLAIMER);
  });

  it("expanded (default) mostra tudo e não corta a narrativa", () => {
    const html = render({ heroPalpite: FULL });
    expect(html).not.toContain("line-clamp-2");
    expect(html).toContain("a partir de:");
    expect(html).toContain("e ainda");
    expect(html).toContain("o palpite leu");
  });

  it("firewall limpo nos dois modos", () => {
    for (const expanded of [true, false]) {
      const html = render({ heroPalpite: FULL, expanded });
      expect(leaksValue(html)).toBe(false);
      expect(html).not.toContain("edge-");
    }
  });
});

describe("PalpiteHero — leitura ao vivo (#594)", () => {
  it("ao vivo: pageLive=1, copy da leitura ao vivo e o selo do momento no palpite", () => {
    const empty = render({ heroPalpite: null, live: true, unavailable: "live", analyzable: true });
    expect(empty).toContain('name="pageLive" value="1"');
    expect(empty).toContain("Com o jogo rolando, a IA lê o placar e o tempo que falta");
    expect(leaksValue(empty)).toBe(false);
    const populated = render({
      heroPalpite: { ...POPULATED, liveLabel: "palpite aos 63' (1–0)" },
      live: true,
      unavailable: "live",
      analyzable: true,
    });
    expect(populated).toContain("palpite aos 63&#x27; (1–0)");
    expect(leaksValue(populated)).toBe(false);
  });

  it("pré-jogo: pageLive=0 e a copy de sempre, sem selo", () => {
    const html = render({ heroPalpite: null });
    expect(html).toContain('name="pageLive" value="0"');
    expect(html).toContain("A IA lê os dois times, os números e o mercado");
    expect(render()).not.toContain("palpite aos");
  });
});

describe("PalpiteHero — progresso ao vivo do run (ADR 0064)", () => {
  // Stream controlado pelo teste: cada `push` é uma linha que o servidor mandou.
  // O GET da rota (marcador do run no servidor) responde `marker`, que o teste troca.
  function controlledFetch() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    // `unavailable` > 0: as próximas leituras respondem 503 (KV sem resposta).
    const state: { marker: RunSnapshot | null; unavailable: number } = {
      marker: null,
      unavailable: 0,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(body, { status: 200 });
      expect(url).toBe(`${PALPITE_RUN_ENDPOINT}?matchId=${MATCH_A}`);
      if (state.unavailable > 0) {
        state.unavailable -= 1;
        return new Response(null, { status: 503 });
      }
      return Response.json({ run: state.marker });
    });
    const encoder = new TextEncoder();
    return {
      fetchMock,
      state,
      push: (msg: StreamMessage) => controller.enqueue(encoder.encode(encodeStreamMessage(msg))),
      close: () => controller.close(),
    };
  }

  async function mountHero(
    heroPalpite: PalpiteHeadlineView | null = null,
    opts: { matchId?: string; activeRun?: RunSnapshot | null } = {},
  ) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PalpiteHero
          contextEnabled={false}
          heroPalpite={heroPalpite}
          matchId={opts.matchId ?? MATCH_A}
          unavailable={null}
          analyzable
          fanOutEnabled
          finalScore={null}
          setId={null}
          sharedAt={null}
          hasAnalyses={false}
          activeRun={opts.activeRun ?? null}
        />,
      );
    });
    const submit = async () => {
      const analyze = container.querySelector<HTMLButtonElement>(
        'button[name="intent"][value="analysis"]',
      )!;
      await act(async () => {
        container.querySelector("form")!.requestSubmit(analyze);
        await settle();
      });
    };
    const flush = () => act(settle);
    const cleanup = async () => {
      await act(async () => root.unmount());
      container.remove();
    };
    return { container, submit, flush, cleanup };
  }

  const rows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("ol[aria-label='etapas da análise'] li")).map(
      (li) => `${li.getAttribute("data-status")}:${li.textContent}`,
    );

  it("mostra as etapas na ordem em que chegam, com o estado de cada uma", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    const h = await mountHero();
    await h.submit();
    // Antes da 1ª etapa: a linha de espera.
    expect(rows(h.container)).toEqual(["active:Começando a análise…"]);
    expect(h.container.textContent).toContain("Analisando o jogo");
    expect(h.container.querySelector("form")!.getAttribute("aria-busy")).toBe("true");

    s.push({ t: "step", id: "sports_data", status: "active", label: "Lendo dados" });
    s.push({ t: "step", id: "jev", status: "active", label: "Consultando o JEV" });
    await h.flush();
    expect(rows(h.container)).toEqual(["active:Lendo dados", "active:Consultando o JEV"]);

    s.push({ t: "step", id: "sports_data", status: "done", label: "Dados lidos" });
    s.push({ t: "ping" });
    await h.flush();
    expect(rows(h.container)).toEqual(["done:Dados lidos", "active:Consultando o JEV"]);
    // O leitor de tela ouve a etapa em andamento.
    expect(h.container.querySelector("ol + [role='status']")?.textContent).toBe(
      "Consultando o JEV",
    );
    expect(leaksValue(h.container.innerHTML)).toBe(false);

    s.push({ t: "step", id: "jev", status: "done", label: "JEV consultado" });
    s.push({ t: "result", outcome: { ok: true, analysis: true } });
    s.close();
    await h.flush();
    // Run ok: a página relê o palpite novo do servidor.
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    await h.cleanup();
  });

  it("falha no fim: mostra o erro e não recarrega a página", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    const h = await mountHero();
    await h.submit();
    s.push({ t: "result", outcome: { ok: false, error: "Você atingiu o limite." } });
    s.close();
    await h.flush();
    expect(h.container.textContent).toContain("Você atingiu o limite.");
    expect(nav.refresh).not.toHaveBeenCalled();
    await h.cleanup();
  });

  it("conexão caiu sem resultado e sem marcador: avisa e relê a página", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    const h = await mountHero();
    await h.submit();
    s.push({ t: "step", id: "odds", status: "active", label: "Lendo os preços" });
    s.close();
    await h.flush();
    await h.flush();
    expect(h.container.textContent).toContain("A conexão caiu antes do fim.");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    await h.cleanup();
  });

  it("conexão caiu no meio: segue o run pelo marcador do servidor até o fim", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    const h = await mountHero();
    await h.submit();
    s.push({ t: "run", id: "run-1" });
    s.push({ t: "step", id: "odds", status: "active", label: "Lendo os preços" });
    s.state.marker = {
      ...snapshot("run-1"),
      steps: [{ id: "odds", status: "done", label: "Preços lidos" }],
    };
    s.close();
    await h.flush();
    expect(rows(h.container)).toEqual(["done:Preços lidos"]);
    expect(h.container.textContent).not.toContain("A conexão caiu");
    expect(nav.refresh).not.toHaveBeenCalled();

    s.state.marker = {
      ...snapshot("run-1"),
      status: "done",
      outcome: { ok: true, analysis: true },
    };
    await h.flush();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(h.container.textContent).not.toContain("A conexão caiu");
    await h.cleanup();
  });

  it("rota ausente (deploy antigo) → cai na server action, sem cobrar duas vezes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    vi.mocked(analyzeBestBet).mockReset();
    vi.mocked(analyzeBestBet).mockResolvedValue({ ok: false, error: "Falhou pela action." });
    const h = await mountHero();
    await h.submit();
    await h.flush();
    expect(analyzeBestBet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(analyzeBestBet).mock.calls[0][1].get("intent")).toBe("analysis");
    expect(h.container.textContent).toContain("Falhou pela action.");
    await h.cleanup();
  });

  it("sem rede: aviso, sem server action (o pedido pode ter chegado)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    vi.mocked(analyzeBestBet).mockReset();
    const h = await mountHero();
    await h.submit();
    await h.flush();
    expect(analyzeBestBet).not.toHaveBeenCalled();
    expect(h.container.textContent).toContain("Não deu pra falar com o servidor.");
    await h.cleanup();
  });

  it("sair do jogo no meio e voltar: o mesmo run segue com as etapas de agora", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    const h = await mountHero();
    await h.submit();
    s.push({ t: "step", id: "sports_data", status: "active", label: "Lendo dados" });
    await h.flush();
    await h.cleanup();

    // Fora do jogo, o stream segue sendo lido.
    s.push({ t: "step", id: "sports_data", status: "done", label: "Dados lidos" });
    s.push({ t: "step", id: "jev", status: "active", label: "Consultando o JEV" });
    await act(settle);
    expect(nav.refresh).not.toHaveBeenCalled();

    const back = await mountHero(POPULATED);
    expect(back.container.textContent).toContain("Analisando o jogo");
    expect(back.container.textContent).not.toContain(POPULATED.verdict);
    expect(rows(back.container)).toEqual(["done:Dados lidos", "active:Consultando o JEV"]);

    s.push({ t: "result", outcome: { ok: true, analysis: true } });
    s.close();
    await back.flush();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    await back.cleanup();
  });

  it("run terminou enquanto estava fora: ao voltar, relê o palpite novo", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    const h = await mountHero();
    await h.submit();
    await h.cleanup();
    s.push({ t: "result", outcome: { ok: true, analysis: true } });
    s.close();
    await act(settle);
    // Ninguém olhando: sem refresh numa página que já é outra.
    expect(nav.refresh).not.toHaveBeenCalled();

    const back = await mountHero();
    await back.flush();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    await back.cleanup();
  });

  it("dois jogos analisando ao mesmo tempo: cada um com o próprio run", async () => {
    const streams = new Map<string, ReturnType<typeof controlledFetch>>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const id = String((init?.body as FormData).get("matchId"));
        const s = controlledFetch();
        streams.set(id, s);
        return s.fetchMock(url, init);
      }),
    );
    const a = await mountHero(null, { matchId: MATCH_A });
    await a.submit();
    await a.cleanup();
    const b = await mountHero(null, { matchId: MATCH_B });
    await b.submit();
    streams.get(MATCH_B)!.push({
      t: "step",
      id: "odds",
      status: "active",
      label: "Lendo os preços do jogo B",
    });
    streams.get(MATCH_A)!.push({
      t: "step",
      id: "jev",
      status: "active",
      label: "Consultando o JEV do jogo A",
    });
    await b.flush();
    expect(rows(b.container)).toEqual(["active:Lendo os preços do jogo B"]);
    await b.cleanup();

    const backA = await mountHero(null, { matchId: MATCH_A });
    expect(rows(backA.container)).toEqual(["active:Consultando o JEV do jogo A"]);
    // O jogo B termina enquanto se olha o A: o A segue analisando.
    streams.get(MATCH_B)!.push({ t: "result", outcome: { ok: false, error: "Falhou o B." } });
    streams.get(MATCH_B)!.close();
    await backA.flush();
    expect(backA.container.textContent).toContain("Analisando o jogo");
    expect(backA.container.textContent).not.toContain("Falhou o B.");
    await backA.cleanup();

    const backB = await mountHero(null, { matchId: MATCH_B });
    await backB.flush();
    expect(backB.container.textContent).toContain("Falhou o B.");
    await backB.cleanup();
  });

  it("página aberta do zero com um run em voo no servidor (F5, outra aba): acompanha até o fim", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    s.state.marker = {
      ...snapshot("run-9"),
      intent: "palpite",
      steps: [{ id: "synthesis", status: "active", label: "Escrevendo o palpite" }],
    };
    // O HTML do servidor já sai com o progresso (sem piscar o palpite antigo).
    const html = render({ activeRun: s.state.marker });
    expect(html).toContain("Escrevendo o palpite");
    expect(html).not.toContain(POPULATED.verdict);

    const h = await mountHero(POPULATED, { activeRun: s.state.marker });
    expect(rows(h.container)).toEqual(["active:Escrevendo o palpite"]);
    expect(h.container.textContent).not.toContain("Analisando o jogo");
    s.state.marker = { ...s.state.marker, status: "done", outcome: { ok: true, analysis: false } };
    await h.flush();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    // Só lê o marcador: nenhum run novo.
    expect(s.fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    await h.cleanup();

    // Uma página antiga do cache que ainda diga "em voo" não volta a acompanhar o run.
    const stale = await mountHero(POPULATED, { activeRun: snapshot("run-9") });
    expect(stale.container.textContent).toContain(POPULATED.verdict);
    await stale.cleanup();
  });

  it("KV sem resposta no acompanhamento: tenta de novo em vez de largar o run", async () => {
    const s = controlledFetch();
    vi.stubGlobal("fetch", s.fetchMock);
    s.state.marker = {
      ...snapshot("run-7"),
      steps: [{ id: "jev", status: "active", label: "Consultando o JEV" }],
    };
    s.state.unavailable = 3;
    const h = await mountHero(POPULATED, { activeRun: s.state.marker });
    await h.flush();
    await h.flush();
    expect(rows(h.container)).toEqual(["active:Consultando o JEV"]);
    expect(nav.refresh).not.toHaveBeenCalled();
    s.state.marker = { ...s.state.marker, status: "done", outcome: { ok: true, analysis: true } };
    await h.flush();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    await h.cleanup();
  });

  it("o FormData enviado leva o intent do botão clicado e o matchId", async () => {
    const fetchMock = streamingFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(analyzeBestBet).mockResolvedValue({ ok: false, error: "x" });
    const h = await mountHero();
    await h.submit();
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    const fd = init.body as FormData;
    expect(fd.get("intent")).toBe("analysis");
    expect(fd.get("matchId")).toBe("11111111-1111-1111-1111-111111111111");
    expect(fd.get("pageLive")).toBe("0");
    await h.cleanup();
  });
});

describe("PalpiteHero — Ver raciocínio + robozinho (ADR 0065)", () => {
  const REASONING: NonNullable<PalpiteHeadlineView["reasoning"]> = [
    {
      id: "sports_data",
      status: "done",
      label: "Forma, confronto direto, tabela e desfalques lidos",
      detail: ["Desfalques: 2 no Palmeiras, 0 no Santos"],
    },
    { id: "news", status: "skipped", label: "Sem tempo para notícias desta vez" },
    {
      id: "synthesis",
      status: "done",
      label: "Palpite pronto",
      detail: ["Confiança do palpite: média"],
    },
  ];

  async function mount(heroPalpite: PalpiteHeadlineView | null, mascot?: ProgressMascot) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderWith = (view: PalpiteHeadlineView | null, setId: string | null = null) =>
      act(async () => {
        root.render(
          <PalpiteHero
            mascot={mascot}
            contextEnabled={false}
            heroPalpite={view}
            matchId="11111111-1111-1111-1111-111111111111"
            unavailable={null}
            analyzable
            fanOutEnabled
            finalScore={null}
            setId={setId}
            sharedAt={null}
            hasAnalyses={false}
          />,
        );
      });
    await renderWith(heroPalpite);
    const button = () =>
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === " Ver raciocínio" || b.textContent === "Ver raciocínio",
      );
    const dialog = () => document.body.querySelector<HTMLElement>("[role='dialog']");
    const cleanup = async () => {
      await act(async () => root.unmount());
      container.remove();
    };
    return { container, button, dialog, renderWith, cleanup };
  }

  it("palpite com raciocínio gravado: o botão abre o diálogo com cada etapa e o que encontrou", async () => {
    const h = await mount({ ...POPULATED, reasoning: REASONING });
    const btn = h.button();
    expect(btn).toBeDefined();
    expect(btn!.getAttribute("type")).toBe("button");
    await act(async () => btn!.click());
    const dialog = h.dialog()!;
    expect(dialog.textContent).toContain("Raciocínio da análise");
    const items = Array.from(
      dialog.querySelectorAll("ol[aria-label='raciocínio da análise'] > li"),
    ).map((li) => li.getAttribute("data-status"));
    expect(items).toEqual(["done", "skipped", "done"]);
    expect(dialog.textContent).toContain("Desfalques: 2 no Palmeiras, 0 no Santos");
    expect(dialog.textContent).toContain("Confiança do palpite: média");
    expect(leaksValue(dialog.innerHTML)).toBe(false);
    // Abrir o diálogo não dispara o run.
    expect(nav.refresh).not.toHaveBeenCalled();
    await h.cleanup();
  });

  it("palpite antigo, sem raciocínio: sem botão", async () => {
    const h = await mount(POPULATED);
    expect(h.button()).toBeUndefined();
    await h.cleanup();
  });

  it("com a flag em papagaio, o papagaio fica no lugar do robô durante o run (ADR 0068)", async () => {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const h = await mount(null, "papagaio");
    const analyze = h.container.querySelector<HTMLButtonElement>(
      'button[name="intent"][value="analysis"]',
    )!;
    await act(async () => {
      h.container.querySelector("form")!.requestSubmit(analyze);
      await settle();
    });
    expect(h.container.querySelector("[data-testid='parrot-mascot']")).not.toBeNull();
    expect(h.container.querySelector("[data-testid='palpite-bot']")).toBeNull();
    await h.cleanup();
  });

  it("durante o run: robozinho decorativo, botão com as etapas ao vivo; o diálogo segue aberto quando o palpite novo chega", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const push = (msg: StreamMessage) =>
      controller.enqueue(new TextEncoder().encode(encodeStreamMessage(msg)));
    const h = await mount(null);
    const analyze = h.container.querySelector<HTMLButtonElement>(
      'button[name="intent"][value="analysis"]',
    )!;
    await act(async () => {
      h.container.querySelector("form")!.requestSubmit(analyze);
      await settle();
    });
    const bot = h.container.querySelector("[data-testid='palpite-bot']");
    expect(bot?.getAttribute("aria-hidden")).toBe("true");
    // Nenhuma etapa ainda: sem botão.
    expect(h.button()).toBeUndefined();

    push({
      t: "step",
      id: "model",
      status: "done",
      label: "Chances calculadas pelo Dixon-Coles",
      detail: ["Gols esperados: Palmeiras 1,6, Santos 0,9"],
    });
    await act(settle);
    await act(async () => h.button()!.click());
    expect(h.dialog()!.textContent).toContain("Gols esperados: Palmeiras 1,6, Santos 0,9");
    expect(h.dialog()!.textContent).toContain("assim que acontece");

    push({ t: "result", outcome: { ok: true, analysis: true } });
    controller.close();
    await act(settle);
    // O refresh traz o set novo (outro id).
    await h.renderWith({ ...POPULATED, reasoning: REASONING }, "33333333-3333-3333-3333-333333333333");
    await act(settle);
    // Mesmo diálogo, agora com o raciocínio gravado com o palpite.
    expect(h.dialog()!.textContent).toContain("Confiança do palpite: média");
    expect(h.dialog()!.textContent).toContain("nesta análise");
    await h.cleanup();
  });

  it("run que falha com o diálogo aberto: segue nas etapas dele, não nas do palpite anterior", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const push = (msg: StreamMessage) =>
      controller.enqueue(new TextEncoder().encode(encodeStreamMessage(msg)));
    const h = await mount({ ...POPULATED, reasoning: REASONING });
    const analyze = h.container.querySelector<HTMLButtonElement>(
      'button[name="intent"][value="analysis"]',
    )!;
    await act(async () => {
      h.container.querySelector("form")!.requestSubmit(analyze);
      await settle();
    });
    push({ t: "step", id: "odds", status: "failed", label: "Faltaram preços do mercado" });
    await act(settle);
    await act(async () => h.button()!.click());
    push({ t: "result", outcome: { ok: false, error: "Falhou agora." } });
    controller.close();
    await act(settle);
    expect(h.container.textContent).toContain("Falhou agora.");
    const text = h.dialog()!.textContent;
    expect(text).toContain("Faltaram preços do mercado");
    expect(text).not.toContain("Confiança do palpite: média");
    await h.cleanup();
  });
});

