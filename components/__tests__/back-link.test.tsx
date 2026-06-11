import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BackLink } from "@/components/back-link";

describe("BackLink", () => {
  it("renders an anchor to href containing the label", () => {
    const html = renderToStaticMarkup(
      <BackLink href="/admin" label="admin" />,
    );
    expect(html).toContain('href="/admin"');
    expect(html).toContain(">admin</span>");
  });

  it("renders the individual anchor classes (not one frozen class string)", () => {
    const html = renderToStaticMarkup(
      <BackLink href="/admin" label="admin" />,
    );
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("pb-6");
    expect(html).toContain("text-[12.5px]");
    expect(html).toContain("size-3.5");
  });

  it("renders the ChevronLeft icon", () => {
    const html = renderToStaticMarkup(
      <BackLink href="/admin" label="admin" />,
    );
    expect(html).toContain("lucide-chevron-left");
  });
});
