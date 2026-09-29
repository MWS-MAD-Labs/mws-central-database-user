// Shared shape for every resource's cheap "did this filtered set change"
// check - see EmployeeService.getVersion for the pattern other resources
// (interns, students, ...) mirror.
export type ResourceVersionResponse = {
  count: number;
  updated_at: string | null;
};
