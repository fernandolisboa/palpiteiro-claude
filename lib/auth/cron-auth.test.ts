import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/whatever", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAuthorizedCron", () => {
  it("returns false and logs when CRON_SECRET is unset (fail-closed)", () => {
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(isAuthorizedCron(req("Bearer anything"), "settlement")).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ scope: "settlement", event: "missing_cron_secret" }),
    );
    error.mockRestore();
  });

  it("returns false when the Authorization header is missing", () => {
    expect(isAuthorizedCron(req(), "spend_alert")).toBe(false);
  });

  it("returns false on a blank or wrong Authorization header", () => {
    expect(isAuthorizedCron(req(""), "sync_fixtures")).toBe(false);
    expect(isAuthorizedCron(req("Bearer wrong"), "sync_fixtures")).toBe(false);
    expect(isAuthorizedCron(req("s3cret"), "sync_fixtures")).toBe(false);
  });

  it("returns false without throwing on a length-mismatched header", () => {
    // timingSafeEqual throws on unequal-length buffers; the length guard must
    // catch this before the compare.
    expect(() =>
      isAuthorizedCron(req("Bearer s3cret-way-too-long-extra"), "prewarm_odds"),
    ).not.toThrow();
    expect(
      isAuthorizedCron(req("Bearer s3cret-way-too-long-extra"), "prewarm_odds"),
    ).toBe(false);
    // Shorter than expected, too.
    expect(isAuthorizedCron(req("Bearer s3"), "prewarm_odds")).toBe(false);
  });

  it("returns true on the correct Bearer secret", () => {
    expect(isAuthorizedCron(req("Bearer s3cret"), "capture_closing_odds")).toBe(
      true,
    );
  });
});
