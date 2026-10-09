const RECENT_USE_MS = 30 * 24 * 60 * 60 * 1000;

// Was any token of the application used in the last 30 days?
export function usedRecently(dates: (Date | null | undefined)[], now = Date.now()): boolean {
  return dates.some((date) => date && date.getTime() > now - RECENT_USE_MS);
}

export type RemovalFacts = {
  isHub: boolean;
  retired: boolean;
  published: boolean;
  people: number;
  recentlyUsed: boolean;
};

// What stops an application from being deleted, and whether retiring it would open the way.
// Used by the removal check and by the list, so both say the same thing.
export function evaluateRemoval(facts: RemovalFacts) {
  const blockers: string[] = [];
  if (facts.isHub) blockers.push("This is the Hub's own application. Removing it would lock everyone out of the Hub.");
  // A retired application has no working token and gives nobody access, so only the Hub stops it.
  if (!facts.retired && !facts.isHub) {
    if (facts.published) blockers.push("It is showing in the Hub.");
    if (facts.people > 0) {
      blockers.push(`${facts.people} ${facts.people === 1 ? "person has" : "people have"} access to it.`);
    }
    if (facts.recentlyUsed) blockers.push("Its token was used in the last 30 days, so the application is still running.");
  }
  return {
    blockers,
    can_remove: blockers.length === 0,
    retire_available: !facts.isHub && !facts.retired && blockers.length > 0,
  };
}
