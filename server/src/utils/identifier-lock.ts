import { ResponseError } from "../error/response-error";

const IDENTIFIER_EDIT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export function assertIdentifierFieldsEditable(
  createdAt: Date,
  changed: boolean,
  fieldLabel: string,
  now: Date = new Date(),
): void {
  if (!changed) return;

  const withinGracePeriod =
    now.getTime() - createdAt.getTime() <= IDENTIFIER_EDIT_GRACE_PERIOD_MS;
  if (!withinGracePeriod) {
    throw new ResponseError(
      400,
      `${fieldLabel} can only be changed within 24 hours of the record's creation. Soft-delete and recreate the record instead.`,
    );
  }
}
