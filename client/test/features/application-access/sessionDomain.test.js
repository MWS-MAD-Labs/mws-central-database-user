import { describe, expect, it } from 'bun:test'
import { appHomeUrl, parentDomainOf, registrableDomain, sameParentDomain } from '../../../src/features/application-access/utils/sessionDomain.js'

describe('sessionDomain', () => {
  it('finds the domain a person can register, also under a second level suffix like web.id', () => {
    expect(registrableDomain('app.mws.web.id')).toBe('mws.web.id')
    expect(registrableDomain('app-stg.millenniaws.sch.id')).toBe('millenniaws.sch.id')
    expect(registrableDomain('hub.example.com')).toBe('example.com')
    expect(registrableDomain('localhost')).toBe('localhost')
    expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1')
  })

  it('says whether an application is under the same parent domain as the Hub', () => {
    expect(sameParentDomain('https://app.mws.web.id', 'https://daily.mws.web.id/auth/sso')).toBe(true)
    expect(sameParentDomain('https://app.mws.web.id/', 'https://app.mws.web.id/daily-checkin/auth/sso')).toBe(true)
    expect(sameParentDomain('https://app.mws.web.id', 'https://app.millenniaws.sch.id/daily-checkin/auth/sso')).toBe(false)
    // web.id alone is not a parent anyone owns.
    expect(sameParentDomain('https://one.web.id', 'https://two.web.id')).toBe(false)
    expect(sameParentDomain('http://localhost:5175', 'http://localhost:3003/auth/sso')).toBe(true)
    expect(sameParentDomain('', 'https://app.mws.web.id')).toBeNull()
    expect(sameParentDomain('https://app.mws.web.id', 'not an address')).toBeNull()
  })

  it('names the parent domain and finds the page people open', () => {
    expect(parentDomainOf('https://app.mws.web.id')).toBe('mws.web.id')
    expect(appHomeUrl('https://app.millenniaws.sch.id/daily-checkin/auth/sso')).toBe('https://app.millenniaws.sch.id/daily-checkin/')
    expect(appHomeUrl('https://exima.mws.web.id/auth/sso')).toBe('https://exima.mws.web.id/')
    expect(appHomeUrl('')).toBe('')
  })
})
