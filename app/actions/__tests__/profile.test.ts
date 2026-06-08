import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), unstable_update: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({ updateUser: vi.fn() }));

import { updateProfile } from "@/app/actions/profile";
import { auth, unstable_update } from "@/auth";
import { updateUser } from "@/lib/db/queries/users";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockUpdate = vi.mocked(updateUser);
const mockSessionUpdate = vi.mocked(unstable_update);

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
  mockUpdate.mockReset();
  mockSessionUpdate.mockReset();
});

describe("updateProfile", () => {
  it("no session → not ok and updateUser NOT called", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await updateProfile(null, form({ name: "Fulano" }));
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("valid name → updateUser called with session id + null image, session refreshed, ok", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "Fulano" }));
    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: null,
    });
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      user: { name: "Fulano", image: null },
    });
  });

  it("owner gate: writes to the SESSION id, never an id smuggled in the form", async () => {
    mockAuth.mockResolvedValue(USER);
    await updateProfile(null, form({ name: "Fulano", id: "someone-else" }));
    expect(mockUpdate).toHaveBeenCalledWith("u2", expect.anything());
  });

  it("name with surrounding whitespace → trimmed", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "  Fulano  " }));
    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: null,
    });
  });

  it("empty/whitespace name → not ok and updateUser NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "   " }));
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("name longer than 80 chars → not ok", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "x".repeat(81) }));
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("valid name + valid image URL → image persisted and session refreshed with it", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(
      null,
      form({ name: "Fulano", image: "https://x.com/a.png" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: "https://x.com/a.png",
    });
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      user: { name: "Fulano", image: "https://x.com/a.png" },
    });
  });

  it("invalid image URL → not ok and updateUser NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(
      null,
      form({ name: "Fulano", image: "not-a-url" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("blank image → persisted as null (falls back to initials)", async () => {
    mockAuth.mockResolvedValue(USER);
    await updateProfile(null, form({ name: "Fulano", image: "   " }));
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: null,
    });
  });
});
