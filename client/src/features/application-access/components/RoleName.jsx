// A role key in the same burgundy everywhere it is named.
export function RoleName({ children, className = "" }) {
  return <span className={`font-display font-bold text-(--mws-burgundy) ${className}`}>{children}</span>;
}
