import { Eye, EyeOff } from "lucide-react";
import { Button } from "./Button.jsx";

// Show or hide button for the sensitive fields, kept in the top right of the card it belongs to.
export function SensitiveToggle({ revealed, onShow, onHide, loading = false }) {
  if (revealed) {
    if (!onHide) return null;
    return (
      <Button type="button" variant="secondary" onClick={onHide} size="icon" aria-label="Hide" title="Hide">
        <EyeOff size={15} />
      </Button>
    );
  }
  return (
    <Button type="button" loading={loading} onClick={onShow} size="icon" aria-label="Show Sensitive Fields" title="Show Sensitive Fields">
      <Eye size={15} />
    </Button>
  );
}

export function SensitiveHiddenNote({ className }) {
  return <p className={className ?? "text-sm text-(--mws-muted)"}>Sensitive details are hidden.</p>;
}
