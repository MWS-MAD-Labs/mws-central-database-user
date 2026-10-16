import { ExternalLink } from "lucide-react";

// An address that opens in a new tab, so it can be checked without typing it.
export function AddressLink({ url, className = "" }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 break-all font-mono text-xs font-medium text-(--mws-burgundy) hover:underline ${className}`}
    >
      {url}
      <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
    </a>
  );
}
