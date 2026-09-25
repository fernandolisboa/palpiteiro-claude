import { describe, expect, it } from "vitest";

import {
  engineConfigFromModelVersion,
  engineFromModelVersion,
} from "@/lib/ai/engine/analysis-engine";

const CODE_JEV =
  "claude-sonnet-4-5-20250929;engine=code_jev;lambda=heuristic;judg=jev_judgments_v1;w=judgment_weights_v1";

describe("engineFromModelVersion", () => {
  it("sem tag de motor → llm (histórico e caminho atual)", () => {
    expect(engineFromModelVersion("claude-sonnet-4-5-20250929")).toBe("llm");
    expect(engineFromModelVersion("")).toBe("llm");
  });

  it("lê a tag engine=code_jev gravada pelo predict", () => {
    expect(engineFromModelVersion(CODE_JEV)).toBe("code_jev");
  });

  it("não depende da posição da tag", () => {
    expect(
      engineFromModelVersion(
        "claude-haiku-4-5;lambda=dixon_coles;engine=code_jev",
      ),
    ).toBe("code_jev");
  });

  it("engine=llm explícito → llm", () => {
    expect(engineFromModelVersion("claude-haiku-4-5;engine=llm")).toBe("llm");
  });

  it("motor desconhecido → null (não cai no segmento llm)", () => {
    expect(engineFromModelVersion("claude-haiku-4-5;engine=foo")).toBeNull();
    expect(engineFromModelVersion("claude-haiku-4-5;engine=")).toBeNull();
  });

  it("tags sem engine= não mudam o motor", () => {
    expect(engineFromModelVersion("claude-haiku-4-5;lambda=heuristic")).toBe(
      "llm",
    );
  });
});

describe("engineConfigFromModelVersion", () => {
  it("devolve as tags do motor sem o modelo nem engine=", () => {
    expect(engineConfigFromModelVersion(CODE_JEV)).toBe(
      "lambda=heuristic;judg=jev_judgments_v1;w=judgment_weights_v1",
    );
  });

  it("sem tags → null", () => {
    expect(
      engineConfigFromModelVersion("claude-sonnet-4-5-20250929"),
    ).toBeNull();
    expect(
      engineConfigFromModelVersion("claude-haiku-4-5;engine=code_jev"),
    ).toBeNull();
  });
});
