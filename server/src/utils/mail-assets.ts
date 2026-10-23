import { readFileSync } from "node:fs";

// The school logo as a PNG, sent inside the mail (cid) so it is not blocked like an image fetched from a site.
export const LOGO_CID = "millennia-logo";

let logo: Buffer | null | undefined;

function readLogo(): Buffer | null {
  if (logo !== undefined) return logo;
  try {
    logo = readFileSync(new URL("../assets/millennia-logo.png", import.meta.url));
  } catch {
    logo = null;
  }
  return logo;
}

export const hasLogo = (): boolean => readLogo() !== null;

// The attachment list of a sign-in mail: the logo when it can be read, nothing when it cannot (the mail goes without).
export function signInAttachments(): { filename: string; content: Buffer; cid: string; contentType: string }[] {
  const content = readLogo();
  return content ? [{ filename: "millennia-logo.png", content, cid: LOGO_CID, contentType: "image/png" }] : [];
}
