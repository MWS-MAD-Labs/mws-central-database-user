// Renders the cropped region of an image onto a canvas and returns it as a
// Blob - react-easy-crop only reports crop coordinates, actually cutting the
// pixels out is on the caller.
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })
}

// Server resizes the upload to fit inside 800x800 anyway (see
// image-processing.ts), so drawing the crop at its full source resolution -
// which can be several thousand pixels on a modern phone photo - just
// produces a huge blob for no visible gain. Cap the canvas at 2x that so the
// upload stays fast even for a 40+MB original, with headroom for
// high-density displays.
const MAX_OUTPUT_DIMENSION = 1600

export async function getCroppedImageBlob(imageSrc, cropPixels) {
  const image = await loadImage(imageSrc)
  const outputSize = Math.min(
    cropPixels.width,
    cropPixels.height,
    MAX_OUTPUT_DIMENSION,
  )
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const ctx = canvas.getContext('2d')

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outputSize,
    outputSize,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas is empty'))),
      'image/jpeg',
      0.92,
    )
  })
}
