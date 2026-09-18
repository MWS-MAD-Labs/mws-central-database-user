import { afterEach, describe, expect, it, mock } from 'bun:test'
import { getCroppedImageBlob, loadImage } from '../../../src/lib/cropImage.js'

const OriginalImage = globalThis.Image

class TestImage {
  listeners = new Map()

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  set src(value) {
    this.currentSrc = value
    queueMicrotask(() => {
      if (value.includes('fail')) this.listeners.get('error')?.(new Error('Image failed'))
      else this.listeners.get('load')?.()
    })
  }

  setAttribute(name, value) {
    this[name] = value
  }
}

describe('crop image helpers', () => {
  afterEach(() => {
    globalThis.Image = OriginalImage
  })

  it('loads images with anonymous cross-origin mode', async () => {
    globalThis.Image = TestImage
    const image = await loadImage('blob:photo')
    expect(image.currentSrc).toBe('blob:photo')
    expect(image.crossOrigin).toBe('anonymous')
  })

  it('rejects failed image loads', async () => {
    globalThis.Image = TestImage
    await expect(loadImage('blob:fail')).rejects.toThrow('Image failed')
  })

  it('draws a square crop capped at 1600px and returns JPEG', async () => {
    globalThis.Image = TestImage
    const drawImage = mock(() => {})
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const originalToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage })
    HTMLCanvasElement.prototype.toBlob = (callback, type, quality) => {
      expect(type).toBe('image/jpeg')
      expect(quality).toBe(0.92)
      callback(new Blob(['cropped'], { type }))
    }

    try {
      const blob = await getCroppedImageBlob('blob:photo', {
        x: 10,
        y: 20,
        width: 2400,
        height: 1800,
      })
      expect(blob.type).toBe('image/jpeg')
      const canvas = document.querySelector('canvas')
      expect(canvas).toBeNull()
      expect(drawImage).toHaveBeenCalledWith(
        expect.any(TestImage),
        10,
        20,
        2400,
        1800,
        0,
        0,
        1600,
        1600,
      )
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
      HTMLCanvasElement.prototype.toBlob = originalToBlob
    }
  })

  it('rejects an empty canvas result', async () => {
    globalThis.Image = TestImage
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const originalToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} })
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null)
    try {
      await expect(getCroppedImageBlob('blob:photo', { x: 0, y: 0, width: 100, height: 100 }))
        .rejects.toThrow('Canvas is empty')
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
      HTMLCanvasElement.prototype.toBlob = originalToBlob
    }
  })
})
