import { Button } from "../../../components/ui/Button.jsx";
import { CooldownRing } from "../../../components/ui/CooldownRing.jsx";
import { formatWait, useWaitSeconds } from "../hooks/useWait.js";

// A button that waits. `until` is when the server will allow the action again and `total` how long that wait is; while
// it runs the button is off, with the time left in its title, and a ring counts it down around it.
export function CooldownButton({ until, total, waitText, title, disabled, children, ringClassName, ...props }) {
  const left = useWaitSeconds(until);
  const waiting = left > 0;
  return (
    <CooldownRing left={left} total={total} className={ringClassName}>
      <Button {...props} disabled={disabled || waiting} title={waiting ? `Wait ${formatWait(left)} ${waitText}.` : title}>
        {children}
      </Button>
    </CooldownRing>
  );
}
