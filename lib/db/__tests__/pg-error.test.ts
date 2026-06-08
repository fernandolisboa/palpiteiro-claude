import { describe, expect, it } from "vitest";

import { extractDbCause } from "@/lib/db/pg-error";

describe("extractDbCause", () => {
  it("reads libpq fields off a NeonDbError nested under a Drizzle wrapper", () => {
    // Shape of a real neon-http failure: DrizzleQueryError.message is the opaque
    // "Failed query:" wrapper, and the real pg error sits on .cause.
    const neonErr = Object.assign(new Error("foreign key violation"), {
      code: "23503",
      constraint: "ai_calls_user_id_users_id_fk",
      detail: 'Key (user_id)=(a61ec11b) is not present in table "users".',
      table: "ai_calls",
      column: undefined,
    });
    const drizzleErr = Object.assign(
      new Error("Failed query: insert into ai_calls ..."),
      { cause: neonErr },
    );

    expect(extractDbCause(drizzleErr)).toMatchObject({
      code: "23503",
      constraint: "ai_calls_user_id_users_id_fk",
      detail: 'Key (user_id)=(a61ec11b) is not present in table "users".',
      table: "ai_calls",
    });
  });

  it("falls back to the message when there is no pg cause", () => {
    expect(extractDbCause(new Error("boom"))).toEqual({ message: "boom" });
  });

  it("handles non-Error values without throwing", () => {
    expect(extractDbCause("nope")).toEqual({ message: "nope" });
  });
});
