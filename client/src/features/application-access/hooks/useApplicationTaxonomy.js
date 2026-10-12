import { useQuery } from "@tanstack/react-query";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

const EMPTY = { categories: [], scopes: [] };

// The categories and scopes of the master data, in the order they were made.
export function useApplicationTaxonomy() {
  const query = useQuery({
    queryKey: ["application-access", "taxonomy"],
    queryFn: () => applicationAccessApi.taxonomy(),
    staleTime: 60 * 1000,
  });
  return query.data ?? EMPTY;
}

export const nameOf = (list, key) => list.find((item) => item.key === key)?.name ?? "";
