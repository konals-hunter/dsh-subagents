import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyProfileEffort, installEffortInjection } from '../src/effort.ts'
import { SubagentStore } from '../src/store.ts'
import type { SubagentProfile } from '../src/protocol.ts'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
  }
})

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

describe('installEffortInjection', () => {
  it('registers an agent/request waterfall that injects reasoningEffort for profile markers', async () => {
    const listeners: Array<(args: unknown, next: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>> = []
    const ctx = {
      on: vi.fn((_event: string, listener: typeof listeners[number]) => {
        listeners.push(listener)
        return () => {}
      }),
    }
    const store = { find: vi.fn((id: string) => id === 'explore' ? profile : undefined) } as unknown as SubagentStore

    const dispose = installEffortInjection(ctx as never, store)
    expect(ctx.on).toHaveBeenCalledWith('agent/request', expect.any(Function))
    expect(listeners).toHaveLength(1)

    const listener = listeners[0]
    const next = vi.fn(async () => ({ provider: 'jiyuan', model: 'deepseek-v4-flash-0731' }))
    const resolved = await listener({ agent: { options: { subagentProfileId: 'explore' } } }, next)

    expect(resolved).toMatchObject({ provider: 'jiyuan', model: 'deepseek-v4-flash-0731', reasoningEffort: 'high' })
    expect(dispose).toBeTypeOf('function')
  })

  it('handles agents without options', async () => {
    const listeners: Array<(args: unknown, next: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>> = []
    const ctx = {
      on: vi.fn((_event: string, listener: typeof listeners[number]) => {
        listeners.push(listener)
        return () => {}
      }),
    }
    const store = {
      find: vi.fn(),
      resolveContinuableProfile: vi.fn(() => undefined),
    } as unknown as SubagentStore

    installEffortInjection(ctx as never, store)
    const listener = listeners[0]
    const next = vi.fn(async () => ({ provider: 'p', model: 'm' }))
    const resolved = await listener({ agent: {} }, next)

    expect(resolved).toEqual({ provider: 'p', model: 'm' })
    expect(store.find).not.toHaveBeenCalled()
  })

  it('does not re-read the store file on repeated non-marker agent/request events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    writeFileSync(path, JSON.stringify({
      version: 1,
      profiles: [],
      continuableProfiles: { 'child-1': 'explore' },
    }, null, 2), 'utf8')
    const store = new SubagentStore(path)
    const readFile = vi.mocked(readFileSync)
    readFile.mockClear()
    const listeners: Array<(args: unknown, next: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>> = []
    const ctx = {
      on: vi.fn((_event: string, listener: typeof listeners[number]) => {
        listeners.push(listener)
        return () => {}
      }),
    }

    try {
      installEffortInjection(ctx as never, store)
      const listener = listeners[0]
      for (let index = 0; index < 5; index++) {
        const next = vi.fn(async () => ({ provider: 'p', model: 'm' }))
        await listener({ agent: { id: 'not-in-map', options: {} } }, next)
      }

      expect(readFile).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('injects reasoningEffort for resumed continuable children via the store map', async () => {
    const listeners: Array<(args: unknown, next: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>> = []
    const ctx = {
      on: vi.fn((_event: string, listener: typeof listeners[number]) => {
        listeners.push(listener)
        return () => {}
      }),
    }
    const store = {
      find: vi.fn((id: string) => id === 'explore' ? profile : undefined),
      resolveContinuableProfile: vi.fn((childSessionId: string) => childSessionId === 'child-1' ? 'explore' : undefined),
    } as unknown as SubagentStore

    installEffortInjection(ctx as never, store)
    const listener = listeners[0]
    const next = vi.fn(async () => ({ provider: 'jiyuan', model: 'deepseek-v4-flash-0731' }))
    const resolved = await listener({
      agent: {
        id: 'child-1',
        options: { provider: 'jiyuan', model: 'deepseek-v4-flash-0731' },
      },
    }, next)

    expect(resolved).toMatchObject({ provider: 'jiyuan', model: 'deepseek-v4-flash-0731', reasoningEffort: 'high' })
    expect(store.resolveContinuableProfile).toHaveBeenCalledWith('child-1')
    expect(store.find).toHaveBeenCalledWith('explore')
  })

  it('leaves non-profile requests untouched', async () => {
    const listeners: Array<(args: unknown, next: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>> = []
    const ctx = {
      on: vi.fn((_event: string, listener: typeof listeners[number]) => {
        listeners.push(listener)
        return () => {}
      }),
    }
    const store = {
      find: vi.fn(),
      resolveContinuableProfile: vi.fn(() => undefined),
    } as unknown as SubagentStore

    installEffortInjection(ctx as never, store)
    const listener = listeners[0]
    const next = vi.fn(async () => ({ provider: 'p', model: 'm' }))
    const resolved = await listener({ agent: { options: {} } }, next)

    expect(resolved).toEqual({ provider: 'p', model: 'm' })
    expect(store.find).not.toHaveBeenCalled()
  })
})
