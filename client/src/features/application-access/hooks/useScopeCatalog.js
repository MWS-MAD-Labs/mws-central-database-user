import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { buildScopeRules } from "../utils/scopeRules.js";

// The scope rules of the master data, or null until they are loaded.
export function useScopeCatalog() {
  const query = useQuery({
    queryKey: ["application-access", "scope-catalog"],
    queryFn: () => applicationAccessApi.scopeCatalog(),
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => (query.data ? buildScopeRules(query.data) : null), [query.data]);
}
