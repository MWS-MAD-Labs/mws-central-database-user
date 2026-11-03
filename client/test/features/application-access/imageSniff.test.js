import { describe, expect, it } from 'bun:test'
import { sniffImageType } from '../../../src/features/application-access/utils/imageSniff.js'

const file = (bytes, name = 'x.png') => new File([bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes)], name, { type: 'image/png' })
const ascii = (text) => [...text].map((letter) => letter.charCodeAt(0))

describe('sniffImageType', () => {
  it('knows the pictures by their first bytes, whatever the name says', async () => {
    expect(await sniffImageType(file(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])))).toBe('image/png')
    expect(await sniffImageType(file(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])))).toBe('image/jpeg')
    expect(await sniffImageType(file(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')])))).toBe('image/webp')
    expect(await sniffImageType(file(new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypavif')])))).toBe('image/avif')
  })

  it('knows an SVG, with or without the xml line, a comment or a byte order mark', async () => {
    expect(await sniffImageType(file('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'a.png'))).toBe('image/svg+xml')
    expect(await sniffImageType(file('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
    expect(await sniffImageType(file('﻿<!-- made by a tool --><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
  })

  it('gives nothing for what is not a picture', async () => {
    expect(await sniffImageType(file('just some words'))).toBeNull()
    expect(await sniffImageType(file('<html><body>hi</body></html>'))).toBeNull()
    expect(await sniffImageType(file(new Uint8Array([1, 2, 3])))).toBeNull()
  })
})
