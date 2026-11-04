// What a picture really is, from its first bytes and not from its name or the type the system guessed. A file named
// .png can hold an SVG, and a browser will not draw it as a PNG.
const SIGNATURES = [
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
];

const SVG_START = /^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

export async function sniffImageType(file) {
  const head = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
  const known = SIGNATURES.find((item) => item.bytes.every((byte, index) => head[index] === byte));
  if (known) return known.type;
  // WebP is RIFF....WEBP and AVIF has "ftyp" in the second word.
  const ascii = (from, to) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(avif|avis)/.test(ascii(8, 12))) return "image/avif";
  const text = new TextDecoder().decode(head).replace(/^\uFEFF/, "").trimStart();
  return SVG_START.test(text) ? "image/svg+xml" : null;
}

// Logo uploads, the same rule in the form and in App Data. JPG has no transparency, so only SVG and PNG.
export const LOGO_ACCEPT = ".svg,image/svg+xml,.png,image/png";
export const LOGO_HINT = "SVG or PNG, 2 MB at most. A PNG needs at least 128 px on the longest side.";
const LOGO_TYPES = new Set(["image/svg+xml", "image/png"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

// The real type of a logo file, or the problem with it.
export async function checkLogoFile(file) {
  if (file.size > LOGO_MAX_BYTES) return { problem: "The file is too large, 2 MB at most." };
  const type = await sniffImageType(file);
  return LOGO_TYPES.has(type) ? { type } : { problem: "Only SVG or PNG files can be used as a logo." };
}
