import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({
  getUserById: vi.fn(),
  countAdmins: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserAccess: vi.fn(),
}));

import { setUserRole, setUserAccess } from "@/app/actions/admin-users";
import { auth } from "@/auth";
import {
  countAdmins,
  getUserById,
  updateUserAccess,
  updateUserRole,
} from "@/lib/db/queries/users";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockGetUser = vi.mocked(getUserById);
const mockCountAdmins = vi.mocked(countAdmins);
const mockUpdateRole = vi.mocked(updateUserRole);
const mockUpdateAccess = vi.mocked(updateUserAccess);

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_ID = "00000000-0000-4000-8000-000000000002";

const ADMIN = {
  user: { id: ADMIN_ID, email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

const NON_ADMIN = {
  user: { id: TARGET_ID, email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockGetUser.mockReset();
  mockCountAdmins.mockReset();
  mockUpdateRole.mockReset();
  mockUpdateAccess.mockReset();
});

describe("setUserRole", () => {
  it("non-admin caller is rejected; no update", async () => {
    mockAuth.mockResolvedValue(NON_ADMIN);
    const res = await setUserRole(
      null,
      form({ userId: TARGET_ID, role: "admin" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("non-UUID userId → invalid, no update", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserRole(
      null,
      form({ userId: "nope", role: "admin" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("invalid role value → invalid, no update", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserRole(
      null,
      form({ userId: TARGET_ID, role: "superuser" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("changing your OWN role is blocked (anti-lockout)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserRole(
      null,
      form({ userId: ADMIN_ID, role: "user" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("demoting the LAST admin is blocked (countAdmins <= 1)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockGetUser.mockResolvedValue({
      id: TARGET_ID,
      email: "t@x.com",
      role: "admin",
    });
    mockCountAdmins.mockResolvedValue(1);
    const res = await setUserRole(
      null,
      form({ userId: TARGET_ID, role: "user" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("demoting an admin when others remain (countAdmins > 1) → ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockGetUser.mockResolvedValue({
      id: TARGET_ID,
      email: "t@x.com",
      role: "admin",
    });
    mockCountAdmins.mockResolvedValue(2);
    const res = await setUserRole(
      null,
      form({ userId: TARGET_ID, role: "user" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockUpdateRole).toHaveBeenCalledWith(TARGET_ID, "user");
  });

  it("promoting a user to admin → ok (no last-admin check on promotion)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserRole(
      null,
      form({ userId: TARGET_ID, role: "admin" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockUpdateRole).toHaveBeenCalledWith(TARGET_ID, "admin");
    expect(mockCountAdmins).not.toHaveBeenCalled();
  });

  it("demoting a non-existent user → not found, no update", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockGetUser.mockResolvedValue(null);
    const res = await setUserRole(
      null,
      form({ userId: TARGET_ID, role: "user" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });
});

describe("setUserAccess", () => {
  it("non-admin caller is rejected; no update", async () => {
    mockAuth.mockResolvedValue(NON_ADMIN);
    const res = await setUserAccess(
      null,
      form({ userId: TARGET_ID, allowed: "false" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateAccess).not.toHaveBeenCalled();
  });

  it("revoking your OWN access is blocked (anti-lockout)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserAccess(
      null,
      form({ userId: ADMIN_ID, allowed: "false" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateAccess).not.toHaveBeenCalled();
  });

  it("granting your own access is allowed (not a lockout)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserAccess(
      null,
      form({ userId: ADMIN_ID, allowed: "true" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockUpdateAccess).toHaveBeenCalledWith(ADMIN_ID, true);
  });

  it("revoking ANOTHER user's access → ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserAccess(
      null,
      form({ userId: TARGET_ID, allowed: "false" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockUpdateAccess).toHaveBeenCalledWith(TARGET_ID, false);
  });

  it("granting another user's access → ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserAccess(
      null,
      form({ userId: TARGET_ID, allowed: "true" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockUpdateAccess).toHaveBeenCalledWith(TARGET_ID, true);
  });

  it("non-UUID userId → invalid, no update", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserAccess(
      null,
      form({ userId: "nope", allowed: "true" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateAccess).not.toHaveBeenCalled();
  });

  it("malformed allowed value → invalid, NO silent revoke", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await setUserAccess(
      null,
      form({ userId: TARGET_ID, allowed: "garbage" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdateAccess).not.toHaveBeenCalled();
  });
});
