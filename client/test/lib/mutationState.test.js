import { describe, expect, it } from 'bun:test'
import { isPendingFor } from '../../src/lib/mutationState.js'

describe('isPendingFor', () => {
  it('is true only while the mutation runs for that row', () => {
    expect(isPendingFor({ isPending: true, variables: 'a' }, 'a')).toBe(true)
    expect(isPendingFor({ isPending: true, variables: 'a' }, 'b')).toBe(false)
  })

  it('is false once the mutation finished, though its variables are still there', () => {
    expect(isPendingFor({ isPending: false, variables: 'a' }, 'a')).toBe(false)
    expect(isPendingFor({ isPending: false, variables: { id: 'a' } }, (v) => v?.id === 'a')).toBe(false)
  })

  it('reads object variables through a function, and copes with nothing yet', () => {
    expect(isPendingFor({ isPending: true, variables: { id: 'a', mode: 'graceful' } }, (v) => v?.id === 'a')).toBe(true)
    expect(isPendingFor({ isPending: true, variables: undefined }, (v) => v?.id === 'a')).toBe(false)
    expect(isPendingFor({ isPending: true, variables: undefined }, 'a')).toBe(false)
    expect(isPendingFor(undefined, 'a')).toBe(false)
  })
})
