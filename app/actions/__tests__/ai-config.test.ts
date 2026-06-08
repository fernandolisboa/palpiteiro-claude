import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  setDefaultModelId: vi.fn(),
}));

import { updateDefaultModel } from "@/app/actions/ai-config";
import { auth } from "@/auth";
import { setDefaultModelId } from "@/lib/db/queries/ai-config";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockSet = vi.mocked(setDefaultModelId);

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
  mockSet.mockReset();
});

describe("updateDefaultModel", () => {
  it("non-admin caller is rejected and setter is NOT called (gate in the action)", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-opus-4-8" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("admin + valid modelId → setter called with (modelId, userId), returns ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-sonnet-4-5-20250929" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSet).toHaveBeenCalledWith("claude-sonnet-4-5-20250929", "u1");
  });

  it("admin + invalid modelId → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(null, form({ modelId: "foo" }));
    expect(res.ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
