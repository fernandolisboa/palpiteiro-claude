import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Resend: named export `Resend` cuja instância expõe emails.send. Hoist do send
// mock pra a factory referenciá-lo (espelha spend-alert.test).
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(_key?: unknown) {
      void _key;
    }
  },
}));

import { sendInviteEmail } from "@/lib/notifications/invite-email";

const ORIGINAL_ENV = {
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY,
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "e1" }, error: null });
  process.env.RESEND_FROM_EMAIL = "from@palpiteiro.app";
  process.env.AUTH_RESEND_KEY = "re_test";
});

afterEach(() => {
  errorSpy.mockRestore();
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const PARAMS = { to: "x@y.com", signinUrl: "https://app.test/signin" };

describe("sendInviteEmail", () => {
  it("no RESEND_FROM_EMAIL → { sent: false, no_from_address }, no send attempt", async () => {
    delete process.env.RESEND_FROM_EMAIL;
    const res = await sendInviteEmail(PARAMS);
    expect(res).toEqual({ sent: false, reason: "no_from_address" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("no AUTH_RESEND_KEY → { sent: false, no_api_key }, no send attempt", async () => {
    delete process.env.AUTH_RESEND_KEY;
    const res = await sendInviteEmail(PARAMS);
    expect(res).toEqual({ sent: false, reason: "no_api_key" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("happy path → sent: true; send called with from/to and the signin link + 'not a login link' note in the body", async () => {
    const res = await sendInviteEmail(PARAMS);
    expect(res).toEqual({ sent: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as {
      from: string;
      to: string;
      text: string;
    };
    expect(arg.from).toBe("from@palpiteiro.app");
    expect(arg.to).toBe("x@y.com");
    expect(arg.text).toContain("https://app.test/signin");
    expect(arg.text.toLowerCase()).toContain("não é um link de login");
  });

  it("resend returns a RESOLVED API error → { sent: false, send_failed }", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "x", message: "boom" },
    });
    const res = await sendInviteEmail(PARAMS);
    expect(res).toEqual({ sent: false, reason: "send_failed" });
  });

  it("resend throws → { sent: false, send_failed } (never throws to the caller)", async () => {
    sendMock.mockRejectedValue(new Error("network down"));
    const res = await sendInviteEmail(PARAMS);
    expect(res).toEqual({ sent: false, reason: "send_failed" });
  });
});
