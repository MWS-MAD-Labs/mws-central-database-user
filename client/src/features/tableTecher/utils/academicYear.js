// The year the workspace opens on: the active one, else the newest (the list comes newest first).
export function defaultAcademicYearId(academicYears) {
  return (academicYears.find((year) => year.status === "ACTIVE") || academicYears[0])?.id || "";
}
