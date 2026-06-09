import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/invites", () => ({
  addPendingInvite: vi.fn(),
  removePendingInvite: vi.fn(),
}));
vi.mock("@/lib/notifications/invite-email", () => ({
  sendInviteEmail: vi.fn(),
}));

import { inviteUser, revokeInvite } from "@/app/actions/invites";
import { auth } from "@/auth";
import {
  addPendingInvite,
  removePendingInvite,
} from "@/lib/db/queries/invites";
import { sendInviteEmail } from "@/lib/notifications/invite-email";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockAdd = vi.mocked(addPendingInvite);
const mockRemove = vi.mocked(removePendingInvite);
const mockSendEmail = vi.mocked(sendInviteEmail);

const ADMIN = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

const USER = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockAdd.mockReset();
  mockRemove.mockReset();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ sent: true });
  process.env.AUTH_URL = "https://app.test";
});

afterEach(() => {
  if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
});

describe("inviteUser", () => {
  it("non-admin caller is rejected; addPendingInvite and email NOT called (gate in the action)", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await inviteUser(null, form({ email: "new@x.com" }));
    expect(res.ok).toBe(false);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("admin + valid email → addPendingInvite called with email + invitedByUserId, returns ok + emailed", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(null, form({ email: "new@x.com" }));
    expect(res).toEqual({ ok: true, emailed: true });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@x.com", invitedByUserId: "u1" })
    );
  });

  it("admin + valid email + note → note persisted, but NOT leaked to the invitee email", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(
      null,
      form({ email: "new@x.com", note: "amigo" })
    );
    expect(res).toEqual({ ok: true, emailed: true });
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@x.com", note: "amigo" })
    );
    // o aviso só recebe to + signinUrl; a nota interna não vaza pro convidado.
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: "new@x.com",
      signinUrl: "https://app.test/signin",
    });
  });

  it("admin + invalid email → not ok; addPendingInvite and email NOT called (z.email guards)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(null, form({ email: "nope" }));
    expect(res.ok).toBe(false);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("admin + valid email with surrounding whitespace → trimmed and accepted", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(null, form({ email: "  new@x.com " }));
    expect(res).toEqual({ ok: true, emailed: true });
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@x.com" })
    );
  });

  it("sends the notification to the invited address with the /signin link from AUTH_URL", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    await inviteUser(null, form({ email: "new@x.com" }));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: "new@x.com",
      signinUrl: "https://app.test/signin",
    });
  });

  it("email send failure does NOT fail the invite (still whitelisted, emailed: false)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendEmail.mockResolvedValue({ sent: false, reason: "send_failed" });
    const res = await inviteUser(null, form({ email: "new@x.com" }));
    expect(res).toEqual({ ok: true, emailed: false });
    expect(mockAdd).toHaveBeenCalledTimes(1); // convite persistido mesmo assim
  });

  it("AUTH_URL unset → builds a relative /signin; module reports no_base_url → emailed false", async () => {
    delete process.env.AUTH_URL;
    mockAuth.mockResolvedValue(ADMIN);
    mockSendEmail.mockResolvedValue({ sent: false, reason: "no_base_url" });
    const res = await inviteUser(null, form({ email: "new@x.com" }));
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: "new@x.com",
      signinUrl: "/signin",
    });
    expect(res).toEqual({ ok: true, emailed: false });
  });
});

describe("revokeInvite", () => {
  it("non-admin caller is rejected and removePendingInvite is NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await revokeInvite(null, form({ email: "new@x.com" }));
    expect(res.ok).toBe(false);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("admin → removePendingInvite called with the submitted email, returns ok (no email)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await revokeInvite(null, form({ email: "new@x.com" }));
    expect(res).toEqual({ ok: true });
    expect(mockRemove).toHaveBeenCalledWith("new@x.com");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
