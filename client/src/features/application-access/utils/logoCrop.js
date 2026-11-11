export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;
export const LOGO_OUTPUT_SIZE = 512;
// Room kept around the picture at 100%, same as the preview.
const PADDING = 0.05;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Where the picture lands on a square of `size`. Offsets are a share of the square, so the preview and the
// saved PNG agree at any size.
export function placement({ width, height, zoom = 1, offsetX = 0, offsetY = 0, size = LOGO_OUTPUT_SIZE }) {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const fit = Math.min(size / width, size / height) * (1 - PADDING * 2);
  const w = width * fit * z;
  const h = height * fit * z;
  return {
    x: (size - w) / 2 + clamp(offsetX, -1, 1) * size,
    y: (size - h) / 2 + clamp(offsetY, -1, 1) * size,
    w,
    h,
  };
}

export function isUntouched({ zoom, offsetX, offsetY }) {
  return zoom === 1 && offsetX === 0 && offsetY === 0;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The picture could not be read."));
    image.src = src;
  });
}

// The picture at the chosen zoom and position, drawn onto a transparent square and returned as a PNG file.
export async function renderLogoPng({ src, name, zoom, offsetX, offsetY, size = LOGO_OUTPUT_SIZE }) {
  const image = await loadImage(src);
  // An SVG with no width or height reports 0.
  const width = image.naturalWidth || size;
  const height = image.naturalHeight || size;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const { x, y, w, h } = placement({ width, height, zoom, offsetX, offsetY, size });
  canvas.getContext("2d").drawImage(image, x, y, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The picture could not be saved.");
  return new File([blob], `${name || "logo"}.png`, { type: "image/png" });
}
