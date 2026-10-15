// Placeholder unit for people and grades imported without a real one.
export const UNKNOWN_LEGACY_UNIT_NAME = "Unknown / Legacy";

export const isRealUnit = (unit) => unit.name !== UNKNOWN_LEGACY_UNIT_NAME;
