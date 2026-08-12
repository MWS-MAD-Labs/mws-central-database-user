import { StatusBadge } from "../../../components/ui/StatusBadge"; 

export function ServiceBadge({ label, active }) {
  return (
    <StatusBadge tone={active ? "green" : "neutral"}>
      {label}: {active ? "Yes" : "No"}
    </StatusBadge>
  );
}