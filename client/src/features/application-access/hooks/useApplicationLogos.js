import { useQuery } from "@tanstack/react-query";
import { applicationLogosApi } from "../api/applicationLogosApi.js";

export const LOGOS_KEY = ["application-access", "logos"];

// The logos of the master data, by name.
export function useApplicationLogos() {
  const query = useQuery({
    queryKey: LOGOS_KEY,
    queryFn: () => applicationLogosApi.list(),
    staleTime: 60 * 1000,
  });
  return { logos: query.data ?? [], isLoading: query.isLoading };
}
