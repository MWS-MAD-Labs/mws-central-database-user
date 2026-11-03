import sharp, { type Metadata } from "sharp";

// Validate magic bytes, not the client-supplied Content-Type.
const IMAGE_SIGNATURES: { mimeType: string; bytes: number[] }[] = [
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  {
    mimeType: "image/png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mimeType: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (WEBP is bytes 8-11, close enough to gate on)
  {
    mimeType: "image/avif",
    bytes: [0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70],
  },
];

export function detectImageMimeType(buffer: Buffer): string | null {
  const match = IMAGE_SIGNATURES.find((signature) =>
    signature.bytes.every((byte, index) => buffer[index] === byte),
  );
  return match?.mimeType ?? null;
}

const MAX_PHOTO_DIMENSION = 800;

// Resize without upscaling and convert profile photos to WebP.
export async function processPhoto(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // applies EXIF orientation before resizing, then strips it
    .resize({
      width: MAX_PHOTO_DIMENSION,
      height: MAX_PHOTO_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .avif({ quality: 80, effort: 4 })
    .toBuffer();
}

// Google profile photos are square JPEGs.
export async function processPhotoForGoogle(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: 512, height: 512, fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export const LOGO_SIZE = 256;
const LOGO_PADDING = 12;
const LOGO_MIN_EDGE = 128;
const LOGO_MAX_PIXELS = 4096 * 4096;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

// Every logo ends up the same: 256 x 256, transparent, WebP. The picture is fitted inside with a little room around
// it, never cropped or stretched, so a wide logo and a tall logo sit alike on a card.
export async function processLogo(
  buffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const type = detectImageMimeType(buffer);
  if (!type || !LOGO_TYPES.has(type)) {
    throw new LogoImageError("Use a PNG, JPG, WebP or AVIF picture");
  }
  let source: Metadata;
  try {
    source = await sharp(buffer, { limitInputPixels: LOGO_MAX_PIXELS }).metadata();
  } catch {
    throw new LogoImageError("That picture could not be read, or it is too large (4096 px at most)");
  }
  const longest = Math.max(source.width ?? 0, source.height ?? 0);
  if (longest < LOGO_MIN_EDGE) {
    throw new LogoImageError(`The picture is too small, its longest side has to be at least ${LOGO_MIN_EDGE} px`);
  }
  const inner = LOGO_SIZE - LOGO_PADDING * 2;
  const fitted = await sharp(buffer, { limitInputPixels: LOGO_MAX_PIXELS })
    .rotate()
    .resize({ width: inner, height: inner, fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const output = await sharp({
    create: {
      width: LOGO_SIZE,
      height: LOGO_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: fitted, gravity: "centre" }])
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer();
  return { buffer: output, width: LOGO_SIZE, height: LOGO_SIZE };
}

// A picture that cannot become a logo. The message is meant to be shown to the person who uploaded it.
export class LogoImageError extends Error {}
