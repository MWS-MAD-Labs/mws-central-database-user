import { Eye, EyeOff } from "lucide-react";
import { Button } from "./Button.jsx";

// Show or hide button for the sensitive fields, kept in the top right of the card it belongs to.
export function SensitiveToggle({ revealed, onShow, onHide, loading = false }) {
  if (revealed) {
    if (!onHide) return null;
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onHide}>
        <EyeOff size={15} />
        Hide
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="sm" loading={loading} onClick={onShow}>
      <Eye size={15} />
      Show Sensitive Fields
    </Button>
  );
}

export function SensitiveHiddenNote({ className }) {
  return <p className={className ?? "text-sm text-(--mws-muted)"}>Sensitive details are hidden.</p>;
}
