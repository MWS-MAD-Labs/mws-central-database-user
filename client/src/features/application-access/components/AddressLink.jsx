// An address that opens in a new tab, so it can be checked without typing it.
export function AddressLink({ url, className = "" }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`break-all font-mono text-xs font-medium text-(--mws-burgundy) hover:underline ${className}`}
    >
      {url}
    </a>
  );
}
