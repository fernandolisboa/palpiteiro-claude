import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEV_USER_ID } from "@/lib/auth/dev-user";

const { insert, values, onConflictDoNothing } = vi.hoisted(() => {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  return { insert, values, onConflictDoNothing };
});

vi.mock("@/lib/db", () => ({
  db: { insert },
}));

import { ensureDevUser } from "@/lib/db/queries/ensure-dev-user";

describe("ensureDevUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts the admin row idempotently (onConflictDoNothing on id)", async () => {
    await ensureDevUser();

    expect(insert).toHaveBeenCalledTimes(1);
    const inserted = (values.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(inserted.id).toBe(DEV_USER_ID);
    expect(inserted.role).toBe("admin");
    expect(inserted.allowed).toBe(true);
    // Idempotency is the whole point — must not throw on an existing row.
    // No target → suppresses on any unique conflict (id or email).
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(onConflictDoNothing).toHaveBeenCalledWith();
  });
});
