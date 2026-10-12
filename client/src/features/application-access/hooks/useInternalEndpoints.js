import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiClientsApi } from "../../api-clients/api/apiClientsApi.js";

// The endpoints an application can call, as the API Reference lists them, grouped by the scope that opens them.
export function useInternalEndpoints() {
  const query = useQuery({
    queryKey: ["api-clients", "internal-endpoints"],
    queryFn: apiClientsApi.listInternalEndpoints,
    staleTime: 5 * 60 * 1000,
  });
  const byScope = useMemo(() => {
    const map = new Map();
    for (const endpoint of query.data ?? []) {
      for (const scope of [endpoint.scope, ...(endpoint.also_scopes ?? [])]) {
        map.set(scope, [...(map.get(scope) ?? []), endpoint]);
      }
    }
    return map;
  }, [query.data]);
  // How many endpoints a token with these scopes can call. One that asks for two scopes needs both.
  const countFor = (scopeNames) => {
    const held = new Set(scopeNames);
    return (query.data ?? []).filter((endpoint) => [endpoint.scope, ...(endpoint.also_scopes ?? [])].every((name) => held.has(name))).length;
  };
  return { byScope, loaded: query.isSuccess, countFor };
}

// "GET /api/internal/students/lookup?email=..." into the part before the question mark.
export const pathOnly = (path) => path.split("?")[0];
