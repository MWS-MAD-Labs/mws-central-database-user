/* global Bun */
import { describe, expect, it } from 'bun:test'
import { guideRows, workflowJob } from '../../../src/features/application-access/utils/setupGuide.js'

const KEYS = [
  { key: 'HUB_SSO_APP_ID', secret: false },
  { key: 'CENTRAL_API_BASE_URL', secret: false },
  { key: 'CENTRAL_API_TOKEN', secret: true },
  { key: 'CENTRAL_ORGANIZATION_ID', secret: false },
  { key: 'HUB_BASE_URL', secret: false },
  { key: 'HUB_INTERNAL_SECRET', secret: true },
]

// The run block of the job as the guide writes it, with the last command turned into a print of what was picked.
function run(mode, env) {
  const parsed = Bun.YAML.parse(workflowJob({ keys: KEYS, isHub: false, mode }))
  const step = parsed['send-permissions'].steps.find((item) => item.run)
  const script = step.run.replace('node scripts/sync-permissions.mjs', 'echo "SENT $CENTRAL_API_BASE_URL $CENTRAL_API_TOKEN"')
  const result = Bun.spawnSync(['bash', '-c', script], { env: { PATH: process.env.PATH, ...env } })
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString(), step }
}

const STAGING = {
  STAGING_CENTRAL_API_BASE_URL: 'https://staging-db.example.com/api/internal',
  STAGING_CENTRAL_API_TOKEN: 'staging-token',
}
const PRODUCTION = {
  PRODUCTION_CENTRAL_API_BASE_URL: 'https://db.example.com/api/internal/',
  PRODUCTION_CENTRAL_API_TOKEN: 'production-token',
}

describe('the job of the guide', () => {
  it('is valid YAML with a step that sends the permissions, for every way of keeping the values apart', () => {
    for (const mode of ['environments', 'prefixed']) {
      const job = Bun.YAML.parse(workflowJob({ keys: KEYS, isHub: false, mode }))['send-permissions']
      expect(job.needs).toBe('deploy')
      expect(job.steps.some((step) => step.run?.includes('node scripts/sync-permissions.mjs'))).toBe(true)
      expect('environment' in job).toBe(mode === 'environments')
    }
  })

  describe('without Environments', () => {
    it('picks the staging values on a branch that is not main', () => {
      const result = run('prefixed', { GITHUB_REF: 'refs/heads/staging', ...STAGING, ...PRODUCTION })
      expect(result.code).toBe(0)
      expect(result.out).toContain('SENT https://staging-db.example.com/api/internal staging-token')
    })

    it('picks the production values on main, also with a slash at the end of the address', () => {
      const result = run('prefixed', { GITHUB_REF: 'refs/heads/main', ...STAGING, ...PRODUCTION })
      expect(result.code).toBe(0)
      expect(result.out).toContain('SENT https://db.example.com/api/internal/ production-token')
    })

    it('never falls back to the staging values on main, and names what is missing', () => {
      const result = run('prefixed', { GITHUB_REF: 'refs/heads/main', ...STAGING })
      expect(result.code).toBe(1)
      expect(result.out).toContain('PRODUCTION_CENTRAL_API_BASE_URL is not set')
      expect(result.out).not.toContain('SENT')
    })

    it('names the token when only the address is there', () => {
      const result = run('prefixed', { GITHUB_REF: 'refs/heads/staging', STAGING_CENTRAL_API_BASE_URL: STAGING.STAGING_CENTRAL_API_BASE_URL })
      expect(result.code).toBe(1)
      expect(result.out).toContain('STAGING_CENTRAL_API_TOKEN is not set')
    })

    it('refuses an address that is not https or does not end with /api/internal', () => {
      for (const address of ['http://staging-db.example.com/api/internal', 'https://staging-db.example.com']) {
        const result = run('prefixed', { GITHUB_REF: 'refs/heads/staging', STAGING_CENTRAL_API_BASE_URL: address, STAGING_CENTRAL_API_TOKEN: 't' })
        expect(result.code).toBe(1)
        expect(result.out).toContain('must start with https:// and end with /api/internal')
      }
    })

    it('reads only the repository secrets of its own branch from the environment of the step', () => {
      const env = run('prefixed', {}).step.env
      expect(Object.keys(env).sort()).toEqual([
        'PRODUCTION_CENTRAL_API_BASE_URL',
        'PRODUCTION_CENTRAL_API_TOKEN',
        'PRODUCTION_CENTRAL_ORGANIZATION_ID',
        'STAGING_CENTRAL_API_BASE_URL',
        'STAGING_CENTRAL_API_TOKEN',
        'STAGING_CENTRAL_ORGANIZATION_ID',
      ])
    })
  })

  describe('with Environments', () => {
    it('sends with the values of the environment, and names the environment when one is missing', () => {
      const ok = run('environments', { CENTRAL_API_BASE_URL: 'https://db.example.com/api/internal', CENTRAL_API_TOKEN: 't', ENVIRONMENT_NAME: 'staging' })
      expect(ok.code).toBe(0)
      const missing = run('environments', { CENTRAL_API_BASE_URL: 'https://db.example.com/api/internal', ENVIRONMENT_NAME: 'staging' })
      expect(missing.code).toBe(1)
      expect(missing.out).toContain('CENTRAL_API_TOKEN is not set in the GitHub Environment staging')
    })
  })
})

describe('the rows of the table', () => {
  const rows = (mode) =>
    guideRows({ keys: KEYS, applicationId: 'demo', selected: 'staging', environment: 'staging', centralUrl: 'https://db.example.com', hubAddress: 'https://hub.example.com', organizationId: 'org_x', mode })

  it('sets only the address, the token and the Organization ID in GitHub', () => {
    for (const mode of ['environments', 'prefixed']) {
      const github = rows(mode).filter((row) => row.target === 'github').map((row) => row.key)
      expect(github).toEqual(['CENTRAL_API_BASE_URL', 'CENTRAL_API_TOKEN', 'CENTRAL_ORGANIZATION_ID'])
    }
  })

  it('keeps the plain names for the server, also without Environments', () => {
    const server = rows('prefixed').filter((row) => row.target === 'server')
    expect(server.map((row) => row.name)).toEqual(['HUB_SSO_APP_ID', 'HUB_BASE_URL', 'HUB_INTERNAL_SECRET'])
    expect(rows('prefixed').find((row) => row.key === 'CENTRAL_API_TOKEN').name).toBe('STAGING_CENTRAL_API_TOKEN')
  })
})
