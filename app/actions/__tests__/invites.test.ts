import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/invites", () => ({
  addPendingInvite: vi.fn(),
  removePendingInvite: vi.fn(),
}));

import { inviteUser, revokeInvite } from "@/app/actions/invites";
import { auth } from "@/auth";
import {
  addPendingInvite,
  removePendingInvite,
} from "@/lib/db/queries/invites";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockAdd = vi.mocked(addPendingInvite);
const mockRemove = vi.mocked(removePendingInvite);

const ADMIN = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

const USER = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockAdd.mockReset();
  mockRemove.mockReset();
});

describe("inviteUser", () => {
  it("non-admin caller is rejected and addPendingInvite is NOT called (gate in the action)", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await inviteUser(null, form({ email: "new@x.com" }));
    expect(res.ok).toBe(false);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("admin + valid email → addPendingInvite called with email + invitedByUserId, returns ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(null, form({ email: "new@x.com" }));
    expect(res).toEqual({ ok: true });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@x.com", invitedByUserId: "u1" })
    );
  });

  it("admin + valid email + note → note passed through", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(
      null,
      form({ email: "new@x.com", note: "amigo" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@x.com", note: "amigo" })
    );
  });

  it("admin + invalid email → not ok and addPendingInvite NOT called (z.email guards)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(null, form({ email: "nope" }));
    expect(res.ok).toBe(false);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("admin + valid email with surrounding whitespace → trimmed and accepted", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await inviteUser(null, form({ email: "  new@x.com " }));
    expect(res).toEqual({ ok: true });
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@x.com" })
    );
  });
});

describe("revokeInvite", () => {
  it("non-admin caller is rejected and removePendingInvite is NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await revokeInvite(null, form({ email: "new@x.com" }));
    expect(res.ok).toBe(false);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("admin → removePendingInvite called with the submitted email, returns ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await revokeInvite(null, form({ email: "new@x.com" }));
    expect(res).toEqual({ ok: true });
    expect(mockRemove).toHaveBeenCalledWith("new@x.com");
  });
});
