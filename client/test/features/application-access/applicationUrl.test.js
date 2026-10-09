import { describe, expect, it } from 'bun:test'
import { addressProblem, joinAddress, readAddressInput } from '../../../src/features/application-access/utils/applicationUrl.js'

describe('readAddressInput', () => {
  it('takes off a pasted scheme and says which one it was', () => {
    expect(readAddressInput('https://exima.mws.web.id/auth', 'production')).toMatchObject({ rest: 'exima.mws.web.id/auth', scheme: 'https' })
    expect(readAddressInput('http://localhost:3000/x', 'production')).toMatchObject({ rest: 'localhost:3000/x', scheme: 'http' })
  })

  it('copes with capitals, leading spaces, a repeated scheme and a leading //', () => {
    expect(readAddressInput('  HTTPS://Exima.MWS.web.id/Auth/SSO', 'production')).toMatchObject({ rest: 'exima.mws.web.id/Auth/SSO', scheme: 'https' })
    expect(readAddressInput('https://https://a.example.com', 'production')).toMatchObject({ rest: 'a.example.com', scheme: 'https' })
    expect(readAddressInput('//a.example.com/x', 'production')).toMatchObject({ rest: 'a.example.com/x', scheme: null })
  })

  it('leaves a spaces typed inside for the validation to refuse', () => {
    const typed = readAddressInput('exa mple.com', 'production')
    expect(typed.rest).toBe('exa mple.com')
    expect(addressProblem('production', typed.rest)).toBe('No spaces allowed.')
  })

  it('always builds the final value from the environment, never from what was pasted', () => {
    const pasted = readAddressInput('http://exima.mws.web.id/auth', 'production')
    expect(joinAddress('production', pasted.rest)).toBe('https://exima.mws.web.id/auth')
    expect(joinAddress('local', readAddressInput('https://localhost:3000', 'local').rest)).toBe('http://localhost:3000')
  })
})
