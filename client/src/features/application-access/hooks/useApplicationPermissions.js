import { useQuery } from "@tanstack/react-query";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

// What an application registered: the only permissions its roles can carry.
export function useApplicationPermissions(applicationId) {
  return useQuery({
    queryKey: ["application-access", "permissions", applicationId],
    queryFn: () => applicationAccessApi.listPermissions(applicationId),
  });
}
