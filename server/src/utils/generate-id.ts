export function generateAdminId(adminNo: number): string {
  return `ADM-${String(adminNo).padStart(5, "0")}`;
}
