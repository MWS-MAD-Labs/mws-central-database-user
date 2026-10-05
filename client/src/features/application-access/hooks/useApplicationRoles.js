import { useQuery } from "@tanstack/react-query";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

export function useApplicationRoles() {
  return useQuery({
    queryKey: ["application-access", "roles"],
    queryFn: () => applicationAccessApi.listRoles(),
  });
}
