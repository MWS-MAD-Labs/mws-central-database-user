import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { describeScope, groupScopes } from '../../../src/features/api-clients/utils/scopes.js'

// Every scope the server defines has to be described here, or it lands in "Other".
const serverScopes = [
  ...readFileSync(new URL('../../../../server/src/constants/api-scopes.ts', import.meta.url), 'utf8')
    .matchAll(/^\s+[A-Z_]+: "([a-z_:]+)"/gm),
].map((match) => match[1])

describe('scope catalog', () => {
  it('reads the scopes from the server file', () => {
    expect(serverScopes).toContain('application_permissions:write')
    expect(serverScopes.length).toBeGreaterThan(8)
  })

  it('describes every scope the server defines, none ends up under Other', () => {
    for (const name of serverScopes) {
      expect(describeScope(name).group, name).not.toBe('Other')
    }
  })

  it('puts the application scopes under Application Access', () => {
    const groups = groupScopes(['application_entitlements:read', 'application_permissions:write'])
    expect(groups.map((entry) => entry.group)).toEqual(['Application Access'])
    expect(groups[0].items.map((item) => item.name)).toEqual([
      'application_permissions:write',
      'application_entitlements:read',
    ].sort((a, b) => describeScope(a).title.localeCompare(describeScope(b).title)))
  })

  it('writes group names in Title Case', () => {
    const groups = groupScopes(serverScopes).map((entry) => entry.group)
    expect(groups).toContain('Classes and Teachers')
    expect(groups).toContain('Application Access')
  })
})
