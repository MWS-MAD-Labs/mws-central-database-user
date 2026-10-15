import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// Asks `check(address)` once typing has paused. `saved` is the address kept before, which is not asked again.
// `ready` is true for an empty answer's opposite: the address was found, was kept as it was, or was used anyway.
export function useAddressCheck({ address, saved = "", name, check, okVerdicts = ["ok"] }) {
  const [probe, setProbe] = useState("");
  const [anyway, setAnyway] = useState("");
  const unchanged = Boolean(address) && address === saved;

  useEffect(() => {
    if (!address || unchanged) return undefined;
    const timer = setTimeout(() => setProbe(address), 600);
    return () => clearTimeout(timer);
  }, [address, unchanged]);

  const query = useQuery({
    queryKey: ["application-access", name, probe],
    queryFn: () => check(probe),
    enabled: Boolean(probe) && probe === address,
    staleTime: 30_000,
    retry: false,
  });
  const waiting = Boolean(address) && !unchanged && (probe !== address || query.isFetching);
  const answered = probe === address && !query.isFetching && !query.isError;
  // A check may answer with a word, or with { verdict, ... } when it has more to say.
  const detail = answered && query.data && typeof query.data === "object" ? query.data : null;
  const verdict = probe === address && !query.isFetching ? (query.isError ? "failed" : (detail?.verdict ?? query.data)) : null;
  const usedAnyway = anyway === address;
  // A verdict that is not "ok" can still be enough to go on, like a Hub that waits for its key.
  const accepted = Boolean(verdict) && okVerdicts.includes(verdict);
  const ready = Boolean(address) && (unchanged || accepted || usedAnyway);
  return { waiting, verdict, detail, accepted, ready, usedAnyway, acceptAnyway: () => setAnyway(address) };
}
