import { useQuery } from "@tanstack/react-query";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

export function useOrganizations() {
  return useQuery({
    queryKey: ["application-access", "organizations"],
    queryFn: () => applicationAccessApi.listOrganizations(),
  });
}
