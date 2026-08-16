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
    const api = {
      listProfiles: async () => ({ profiles: [profile], corrupt: false }),
      listThinkingConfigs: async () => ({ configs: [] }),
    } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().profiles[0].id).toBe('explore')
    expect(controller.store.getSnapshot().corrupt).toBe(false)
  })

  it('loads corrupt flag into the store', async () => {
    const api = {
      listProfiles: async () => ({ profiles: [profile], corrupt: true }),
      listThinkingConfigs: async () => ({ configs: [] }),
    } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().corrupt).toBe(true)
  })

  it('reports load errors', async () => {
    const api = {
      listProfiles: async () => { throw new Error('boom') },
      listThinkingConfigs: async () => ({ configs: [] }),
    } as never
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

  it('clears corrupt and error after a successful create', async () => {
    const created: SubagentProfile = { ...profile, id: 'custom-1', builtin: false }
    const api = {
      listProfiles: async () => ({ profiles: [profile], corrupt: true }),
      listThinkingConfigs: async () => ({ configs: [] }),
      restoreBuiltins: async () => ({
        profiles: [profile],
        corrupt: true,
        error: 'store file is corrupt; manual recovery required',
      }),
      createProfile: vi.fn(async () => created),
    } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    await controller.restoreBuiltins()
    expect(controller.store.getSnapshot().corrupt).toBe(true)
    expect(controller.store.getSnapshot().error).toContain('corrupt')

    await controller.create({
      id: 'custom-1',
      name: 'Custom',
      description: 'custom',
      enabled: true,
      provider: 'spawn',
      modelProvider: 'jiyuan',
      model: 'deepseek-v4-flash-0731',
    })

    const snapshot = controller.store.getSnapshot()
    expect(snapshot.corrupt).toBe(false)
    expect(snapshot.error).toBeUndefined()
    expect(snapshot.profiles.map(p => p.id)).toContain('custom-1')
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

  it('loads thinking configs into the store', async () => {
    const api = {
      listProfiles: async () => ({ profiles: [profile], corrupt: false }),
      listThinkingConfigs: async () => ({ configs: [{ provider: 'stepfun', model: 'step-3.7-flash', variants: [{ id: 'low', name: 'low' }], defaultVariant: 'low' }] }),
    } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot().thinkingConfigs[0]?.model).toBe('step-3.7-flash')
  })

  it('passes thinking config CRUD through to the API', async () => {
    const create = vi.fn(async () => ({ provider: 'p', model: 'm', variants: [{ id: 'a', name: 'A' }] }))
    const update = vi.fn(async () => ({ provider: 'p', model: 'm', variants: [{ id: 'a', name: 'A' }] }))
    const del = vi.fn(async () => {})
    const controller = new SubagentsSectionController({ createThinkingConfig: create, updateThinkingConfig: update, deleteThinkingConfig: del } as never)
    await controller.createThinkingConfig({ provider: 'p', model: 'm', variants: [{ id: 'a', name: 'A' }] })
    await controller.updateThinkingConfig('p', 'm', { defaultVariant: 'a' })
    await controller.deleteThinkingConfig('p', 'm')
    expect(create).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('p', 'm', { defaultVariant: 'a' })
    expect(del).toHaveBeenCalledWith('p', 'm')
  })
})
