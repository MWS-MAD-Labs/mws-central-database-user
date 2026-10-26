import { describe, expect, it } from 'bun:test'
import { addressClash } from '../../../src/features/application-access/utils/applicationAddress.js'

const app = (application_id, name, launch_url, retired = false) => ({ application_id, name, launch_url, retired })

describe('addressClash', () => {
  it('refuses the same address, and a port on a local host whatever the path', () => {
    const others = [app('exima', 'Exima', 'http://localhost:3001/auth/sso')]
    expect(addressClash('http://localhost:3001/auth/sso/', others)).toEqual({ type: 'taken', name: 'Exima' })
    expect(addressClash('http://localhost:3001/api/v1/auth/sso', others)).toEqual({ type: 'port', name: 'Exima' })
    expect(addressClash('http://localhost:3002/api/v1/auth/sso', others)).toBeNull()
    expect(addressClash('http://localhost:3001/auth/sso', others, 'exima')).toBeNull()
  })

  it('lets a real domain be shared by path, with a note, and ignores retired ones', () => {
    const others = [app('daily', 'Daily', 'https://apps.example.com/daily/auth/sso'), app('old', 'Old', 'https://other.example.com/x', true)]
    expect(addressClash('https://apps.example.com/mtss/auth/sso', others)).toEqual({ type: 'domain', name: 'Daily' })
    expect(addressClash('https://apps.example.com/daily/auth/sso', others)).toEqual({ type: 'taken', name: 'Daily' })
    expect(addressClash('https://other.example.com/x', others)).toBeNull()
    expect(addressClash('', others)).toBeNull()
  })
})
