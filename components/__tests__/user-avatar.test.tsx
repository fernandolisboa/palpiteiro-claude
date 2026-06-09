import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { UserAvatar } from "@/components/user-avatar";

describe("UserAvatar", () => {
  it("renders the image when src is present", () => {
    const html = renderToStaticMarkup(
      <UserAvatar initials="PA" hue={258} src="https://x.com/a.png" />
    );
    expect(html).toContain("<img");
    expect(html).toContain("https://x.com/a.png");
  });

  it("falls back to the initials monogram when src is absent", () => {
    const html = renderToStaticMarkup(
      <UserAvatar initials="PA" hue={258} src={null} />
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("PA");
  });
});
