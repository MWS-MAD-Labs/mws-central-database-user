import { describe, expect, it } from 'bun:test'
import { buildSteps, stepsDone, timeAgo } from '../../../src/features/application-access/utils/setupSteps.js'

const NOW = new Date('2026-10-09T12:00:00Z').getTime()

function setup(overrides = {}) {
  return {
    application: { name: 'Demo', launch_url: 'https://demo.example.com', published: false },
    connection: { created: false, last_used_at: null },
    permissions: { count: 0, synced_at: null },
    roles: { active_count: 0 },
    groups: { active_count: 0 },
    can_publish: false,
    ...overrides,
  }
}

const statuses = (steps) => steps.map((step) => `${step.id}:${step.status}`)

describe('timeAgo', () => {
  it('reads like a person would say it', () => {
    expect(timeAgo(new Date(NOW - 10_000), NOW)).toBe('just now')
    expect(timeAgo(new Date(NOW - 60_000), NOW)).toBe('1 minute ago')
    expect(timeAgo(new Date(NOW - 5 * 60_000), NOW)).toBe('5 minutes ago')
    expect(timeAgo(new Date(NOW - 3 * 3_600_000), NOW)).toBe('3 hours ago')
    expect(timeAgo(new Date(NOW - 2 * 86_400_000), NOW)).toBe('2 days ago')
    expect(timeAgo(null, NOW)).toBe('')
  })
})

describe('buildSteps', () => {
  it('starts at Connect once the details are there, later steps are locked', () => {
    expect(statuses(buildSteps(setup(), NOW))).toEqual([
      'about:done',
      'connect:current',
      'permissions:locked',
      'roles:locked',
      'groups:locked',
      'hub:locked',
    ])
  })

  it('waits for the application after the connection is created', () => {
    const steps = buildSteps(setup({ connection: { created: true, last_used_at: null } }), NOW)
    expect(steps[1].status).toBe('current')
    expect(steps[1].note).toBe('Waiting for the application. Deploy it with the .env values and its permission sync.')
  })

  it('counts the connection as done once the application called Central', () => {
    const steps = buildSteps(
      setup({ connection: { created: true, last_used_at: new Date(NOW - 120_000).toISOString() } }),
      NOW,
    )
    expect(steps[1]).toMatchObject({ done: true, note: 'Connected, last call 2 minutes ago.' })
    expect(steps[2].status).toBe('current')
  })

  it('treats received permissions as proof of the connection', () => {
    const steps = buildSteps(
      setup({
        connection: { created: true, last_used_at: null },
        permissions: { count: 12, synced_at: new Date(NOW - 60_000).toISOString() },
      }),
      NOW,
    )
    expect(steps[1].done).toBe(true)
    expect(steps[2]).toMatchObject({ done: true, note: '12 permissions received, 1 minute ago.' })
    expect(steps[3].status).toBe('current')
  })

  it('is finished when the application is published', () => {
    const steps = buildSteps(
      setup({
        application: { name: 'Demo', launch_url: 'https://demo.example.com', published: true },
        connection: { created: true, last_used_at: new Date(NOW).toISOString() },
        permissions: { count: 1, synced_at: null },
        roles: { active_count: 1 },
        groups: { active_count: 1 },
      }),
      NOW,
    )
    expect(stepsDone(steps)).toBe(6)
    expect(steps.every((step) => step.status === 'done')).toBe(true)
  })

  it('keeps Show in Hub as the next step when everything before it is done', () => {
    const steps = buildSteps(
      setup({
        connection: { created: true, last_used_at: new Date(NOW).toISOString() },
        permissions: { count: 1, synced_at: null },
        roles: { active_count: 1 },
        groups: { active_count: 1 },
        can_publish: true,
      }),
      NOW,
    )
    expect(stepsDone(steps)).toBe(5)
    expect(steps[5].status).toBe('current')
  })
})
