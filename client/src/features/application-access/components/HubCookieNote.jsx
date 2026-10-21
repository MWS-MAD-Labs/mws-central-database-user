// What the running Hub says its shared session cookie is called, next to the name set in Central. `reported` is the
// name, null when the Hub does not say, undefined when it was not asked.
export function HubCookieNote({ reported, expected }) {
  if (reported === undefined) return null;
  if (reported === null) {
    return (
      <p role="note" className="text-xs text-(--mws-muted)">
        This Hub does not report its cookie name yet.
      </p>
    );
  }
  if (reported === expected) {
    return (
      <p role="note" className="text-xs text-(--mws-muted)">
        The running Hub uses the same cookie name.
      </p>
    );
  }
  return (
    <p role="note" className="text-xs text-[#8a5a12]">
      The running Hub reports <span className="font-mono">{reported}</span>, but the setting here is <span className="font-mono">{expected}</span>.
      Copy the Hub lines and restart the Hub, or set the same name here.
    </p>
  );
}
