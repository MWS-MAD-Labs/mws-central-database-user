import { useQuery } from "@tanstack/react-query";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

// Values of each dimension that can still hold someone given the other two, as Sets.
// null until the server answered, and for students (who only have a unit).
export function useScopeOptions({ audience, scope }) {
  const query = useQuery({
    queryKey: [
      "application-access",
      "scope-options",
      audience,
      scope.unit_ids.join(","),
      scope.job_position_ids.join(","),
      scope.job_level_ids.join(","),
    ],
    queryFn: () =>
      applicationAccessApi.scopeOptions({
        audience,
        unit_ids: scope.unit_ids.join(","),
        job_position_ids: scope.job_position_ids.join(","),
        job_level_ids: scope.job_level_ids.join(","),
      }),
    enabled: audience !== "STUDENTS",
    placeholderData: (previous) => previous,
  });
  if (audience === "STUDENTS" || !query.data) return null;
  return {
    units: new Set(query.data.units),
    job_positions: new Set(query.data.job_positions),
    job_levels: new Set(query.data.job_levels),
  };
}
