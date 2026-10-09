// The application that is the Hub itself. It is not listed in the Hub, and it cannot be removed.
export function hubApplicationId(): string {
  return process.env.HUB_APPLICATION_ID?.trim() || "hub";
}
