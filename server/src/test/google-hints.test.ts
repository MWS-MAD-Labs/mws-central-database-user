import { describe, expect, it } from "bun:test";
import { GoogleSyncStatus } from "../generated/prisma/client";
import { googleHintsOf, passwordStateOf } from "../utils/google-hints";

const person = (over: Record<string, unknown> = {}) => ({
  google_user_id: "g1",
  google_sync_status: GoogleSyncStatus.ACTIVE,
  google_last_error: null,
  google_deleted_at: null,
  google_password_pending: false,
  google_password_issued_at: null,
  google_suspended_by_central: false,
  ...over,
});
const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const codes = (over: Record<string, unknown>, left = false) => googleHintsOf(person(over) as never, { left }).map((hint) => hint.code);

describe("google hints for the lists", () => {
  it("says nothing for a healthy account and for a person with no account", () => {
    expect(codes({})).toEqual([]);
    expect(codes({ google_user_id: null, google_sync_status: GoogleSyncStatus.NONE })).toEqual([]);
  });

  it("flags a failed account, with the reason, even before it was ever linked", () => {
    const hints = googleHintsOf(
      person({ google_user_id: null, google_sync_status: GoogleSyncStatus.FAILED, google_last_error: "Google refused" }) as never,
      { left: false },
    );
    expect(hints).toEqual([{ code: "FAILED", detail: "Google refused" }]);
  });

  it("flags a deleted account with the last day it can be restored, and a missing one without", () => {
    const deleted = googleHintsOf(
      person({ google_sync_status: GoogleSyncStatus.MISSING, google_deleted_at: days(8) }) as never,
      { left: false },
    );
    expect(deleted[0].code).toBe("DELETED");
    const until = new Date(deleted[0].detail as string).getTime();
    expect(Math.round((until - Date.now()) / 86_400_000)).toBe(12);
    expect(codes({ google_sync_status: GoogleSyncStatus.MISSING })).toEqual(["MISSING"]);
  });

  it("flags a suspended account only when nobody expects it", () => {
    expect(codes({ google_sync_status: GoogleSyncStatus.SUSPENDED })).toEqual(["SUSPENDED"]);
    expect(codes({ google_sync_status: GoogleSyncStatus.SUSPENDED }, true)).toEqual([]);
    expect(codes({ google_sync_status: GoogleSyncStatus.SUSPENDED, google_suspended_by_central: true })).toEqual([]);
  });

  it("flags an account of someone who left that is still active, and a password not set for a week", () => {
    expect(codes({}, true)).toEqual(["LEFT_STILL_ACTIVE"]);
    expect(codes({ google_password_pending: true, google_password_issued_at: days(3) })).toEqual([]);
    expect(codes({ google_password_pending: true, google_password_issued_at: days(9) })).toEqual(["PASSWORD_OVERDUE"]);
    expect(passwordStateOf(person({ google_password_pending: true, google_password_issued_at: days(9) }) as never)).toBe("OVERDUE");
  });
});
