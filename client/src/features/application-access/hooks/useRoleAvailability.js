import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

// Roles a group with this scope cannot take, by the same rules the server saves with.
export function useRoleAvailability(request) {
  // Picking chips quickly asks once, not once per click.
  const wanted = JSON.stringify(request);
  const [settled, setSettled] = useState(wanted);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(wanted), 300);
    return () => window.clearTimeout(timer);
  }, [wanted]);
  const { applicationId, audience, scope, groupId } = JSON.parse(settled);
  const key = [
    audience,
    scope.unit_ids.join(","),
    scope.job_position_ids.join(","),
    scope.job_level_ids.join(","),
    groupId || "",
  ];
  const query = useQuery({
    queryKey: ["application-access", "role-options", applicationId, ...key],
    queryFn: () =>
      applicationAccessApi.roleOptions(applicationId, {
        audience,
        unit_ids: scope.unit_ids.join(","),
        job_position_ids: scope.job_position_ids.join(","),
        job_level_ids: scope.job_level_ids.join(","),
        group_id: groupId,
      }),
    placeholderData: (previous) => previous,
  });
  return new Set((query.data?.unavailable || []).map((item) => item.role));
}
