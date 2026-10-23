import { Button } from "../../../components/ui/Button.jsx";
import { CooldownRing } from "../../../components/ui/CooldownRing.jsx";
import { formatWait, useCooldown } from "../hooks/useWait.js";

// A button that waits. `until` is when the server will allow the action again and `total` how long that wait is; while
// it runs the button is off, with the time left in its title, and a ring counts it down around it. The button and the
// ring read the same end, so the ring is empty at the moment the button turns on.
export function CooldownButton({ until, total, waitText, title, disabled, children, ringClassName, ...props }) {
  const wait = useCooldown(until, total);
  return (
    <CooldownRing waiting={wait.waiting} until={until} total={total} className={ringClassName}>
      <Button {...props} disabled={disabled || wait.waiting} title={wait.waiting ? `Wait ${formatWait(wait.seconds)} ${waitText}.` : title}>
        {children}
      </Button>
    </CooldownRing>
  );
}
