import { useQuery } from "@tanstack/react-query";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

// Roles per application, highest first. The server sends them ordered, this keeps it so.
export function useApplicationRoles() {
  return useQuery({
    queryKey: ["application-access", "roles"],
    queryFn: () => applicationAccessApi.listRoles(),
    select: (roles) =>
      [...roles].sort(
        (left, right) =>
          left.application_id.localeCompare(right.application_id) ||
          left.rank - right.rank ||
          left.key.localeCompare(right.key),
      ),
  });
}
