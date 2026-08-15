/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { SubagentsSectionController } from '../src/client/controller.ts'
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
  createdAt: 1,
  updatedAt: 1,
}

describe('SubagentsSectionController', () => {
  it('loads profiles into the store', async () => {
    const api = { listProfiles: async () => [profile] } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().profiles[0].id).toBe('explore')
  })

  it('reports load errors', async () => {
    const api = { listProfiles: async () => { throw new Error('boom') } } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toContain('boom')
  })
})
