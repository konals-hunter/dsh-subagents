/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
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
    const api = { listProfiles: async () => ({ profiles: [profile], corrupt: false }) } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().profiles[0].id).toBe('explore')
    expect(controller.store.getSnapshot().corrupt).toBe(false)
  })

  it('loads corrupt flag into the store', async () => {
    const api = { listProfiles: async () => ({ profiles: [profile], corrupt: true }) } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().corrupt).toBe(true)
  })

  it('reports load errors', async () => {
    const api = { listProfiles: async () => { throw new Error('boom') } } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toContain('boom')
  })

  it('passes toolFilter null through to the API when clearing a filter', async () => {
    const updateProfile = vi.fn(async () => profile)
    const controller = new SubagentsSectionController({ updateProfile } as never)
    await controller.update('explore', { toolFilter: null })
    expect(updateProfile).toHaveBeenCalledWith('explore', { toolFilter: null })
  })

  it('passes null through to the API when clearing optional profile fields', async () => {
    const updateProfile = vi.fn(async () => profile)
    const controller = new SubagentsSectionController({ updateProfile } as never)
    await controller.update('explore', { reasoningEffort: null, maxTokens: null, maxDepth: null })
    expect(updateProfile).toHaveBeenCalledWith('explore', { reasoningEffort: null, maxTokens: null, maxDepth: null })
  })

  it('restores builtins and surfaces corrupt recovery error', async () => {
    const api = {
      restoreBuiltins: async () => ({
        profiles: [profile],
        corrupt: true,
        error: 'store file is corrupt; manual recovery required',
      }),
    } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.restoreBuiltins()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().corrupt).toBe(true)
    expect(controller.store.getSnapshot().error).toContain('corrupt')
  })
})
