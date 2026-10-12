import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// Asks `check(address)` once typing has paused. `saved` is the address kept before, which is not asked again.
// `ready` is true for an empty answer's opposite: the address was found, was kept as it was, or was used anyway.
export function useAddressCheck({ address, saved = "", name, check }) {
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
  const verdict = probe === address && !query.isFetching ? (query.isError ? "failed" : query.data) : null;
  const usedAnyway = anyway === address;
  const ready = Boolean(address) && (unchanged || verdict === "ok" || usedAnyway);
  return { waiting, verdict, ready, usedAnyway, acceptAnyway: () => setAnyway(address) };
}
