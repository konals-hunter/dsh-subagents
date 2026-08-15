import { describe, expect, it } from 'vitest'
import { applyProfileEffort } from '../src/effort.ts'
import type { SubagentProfile } from '../src/protocol.ts'

const profile: SubagentProfile = {
  id: 'explore',
  name: 'Explore',
  description: 'explore',
  enabled: true,
  builtin: true,
  provider: 'spawn',
  modelProvider: 'jiyuan',
  model: 'deepseek-v4-flash-0731',
  reasoningEffort: 'high',
  createdAt: 1,
  updatedAt: 1,
}

describe('applyProfileEffort', () => {
  it('injects reasoningEffort for a matching profile marker', () => {
    const resolved = { provider: 'jiyuan', model: 'deepseek-v4-flash-0731' }
    const next = applyProfileEffort(resolved, { subagentProfileId: 'explore' }, profile)
    expect(next).toMatchObject({ reasoningEffort: 'high' })
  })

  it('leaves ordinary agents untouched', () => {
    const resolved = { provider: 'jiyuan', model: 'deepseek-v4-flash-0731' }
    const next = applyProfileEffort(resolved, {}, profile)
    expect(next.reasoningEffort).toBeUndefined()
  })

  it('preserves resolved fields', () => {
    const resolved = { provider: 'p', model: 'm', maxTokens: 100 }
    const next = applyProfileEffort(resolved, { subagentProfileId: 'explore' }, profile)
    expect(next).toMatchObject({ provider: 'p', model: 'm', maxTokens: 100 })
  })
})
