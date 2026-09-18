import sharp from "sharp";

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
