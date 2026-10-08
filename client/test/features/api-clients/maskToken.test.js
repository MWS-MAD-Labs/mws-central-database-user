import { describe, expect, it } from 'bun:test'
import { maskToken } from '../../../src/features/api-clients/utils/maskToken.js'

describe('maskToken', () => {
  it('shows the start and the end with a fixed run of dots between', () => {
    const token = 'mws_47d0b31fa20c8e19d5a4b7c3f20e6a91d8b4c7e5f3a2b1c0d9e8f7a6b5c4d3e2'
    expect(maskToken(token)).toBe('mws_47d0b3••••••••••••d3e2')
    expect(maskToken(`${token}${token}`)).toBe('mws_47d0b3••••••••••••d3e2')
  })

  it('shows almost nothing of a short token, and nothing of an empty one', () => {
    expect(maskToken('mws_short')).toBe('mw••••••••••••')
    expect(maskToken('')).toBe('')
    expect(maskToken(undefined)).toBe('')
  })
})
