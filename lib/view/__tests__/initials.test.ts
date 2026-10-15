import { describe, expect, it } from "vitest";

import { userInitials } from "@/lib/view/initials";

describe("userInitials (#574)", () => {
  it("nome composto: inicial do primeiro e do último", () => {
    expect(userInitials("Fernando Lisboa")).toBe("FL");
    expect(userInitials("Fernando Igor Lisboa")).toBe("FL");
    expect(userInitials("  ana   maria  ")).toBe("AM");
  });

  it("e-mail: a parte antes do @, quebrada em . _ -", () => {
    expect(userInitials("fernando.lisboa@example.com")).toBe("FL");
    expect(userInitials("fernando_igor-lisboa@example.com")).toBe("FL");
    expect(userInitials("fernandoigorlisboa@example.com")).toBe("FE");
  });

  it("um nome só: as duas primeiras letras", () => {
    expect(userInitials("fernando")).toBe("FE");
  });

  it("acentos ficam (não somem como antes)", () => {
    expect(userInitials("Érica Souza")).toBe("ÉS");
    expect(userInitials("érica")).toBe("ÉR");
  });

  it("sem letra: '??'", () => {
    expect(userInitials("")).toBe("??");
    expect(userInitials("123 456")).toBe("??");
  });
});
