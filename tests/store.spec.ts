import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SubagentStore, validateProfilePayload } from '../src/store.ts'
import type { SubagentProfilePayload } from '../src/protocol.ts'

function tempStore(): { store: SubagentStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
  return { store: new SubagentStore(join(dir, 'store.json')), dir }
}

function payload(overrides: Partial<SubagentProfilePayload> = {}): SubagentProfilePayload {
  return {
    id: 'custom-1',
    name: 'Custom',
    description: 'A custom subagent',
    enabled: true,
    provider: 'spawn',
    modelProvider: 'jiyuan',
    model: 'deepseek-v4-flash-0731',
    ...overrides,
  }
}

describe('SubagentStore', () => {
  it('seeds builtins on first list and merges missing builtins later', () => {
    const { store, dir } = tempStore()
    try {
      const listed = store.list()
      expect(listed.map(p => p.id)).toEqual(['explore', 'general', 'vision'])
      expect(listed.every(p => p.builtin)).toBe(true)
      const raw = JSON.parse(readFileSync(store.path, 'utf8')) as { profiles: Array<{ id: string }> }
      expect(raw.profiles).toHaveLength(3)

      const missingGeneral = { version: 1, profiles: raw.profiles.filter(p => p.id !== 'general') }
      writeFileSync(store.path, JSON.stringify(missingGeneral, null, 2))
      const restored = store.restoreBuiltins()
      expect(restored.map(p => p.id)).toContain('general')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not overwrite an existing builtin', () => {
    const { store, dir } = tempStore()
    try {
      store.update('explore', { name: 'Renamed Explore' })
      const raw = JSON.parse(readFileSync(store.path, 'utf8')) as { profiles: Array<{ id: string; name: string }> }
      expect(raw.profiles.find(p => p.id === 'explore')?.name).toBe('Renamed Explore')
      store.restoreBuiltins()
      const after = store.find('explore')
      expect(after?.name).toBe('Renamed Explore')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('creates, updates, deletes and notifies subscribers', () => {
    const { store, dir } = tempStore()
    try {
      const events: number[] = []
      const unsubscribe = store.subscribe(() => events.push(store.list().length))
      const created = store.create(payload({ id: 'custom-a' }))
      expect(created.id).toBe('custom-a')
      expect(events).toEqual([4])
      const updated = store.update(created.id, { model: 'deepseek-v4-pro' })
      expect(updated.model).toBe('deepseek-v4-pro')
      expect(updated.builtin).toBe(false)
      store.delete(created.id)
      expect(store.find(created.id)).toBeUndefined()
      unsubscribe()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects duplicate ids and builtin deletion', () => {
    const { store, dir } = tempStore()
    try {
      expect(() => store.create(payload({ id: 'explore' }))).toThrow(/already exists|已存在/)
      expect(() => store.delete('explore')).toThrow(/builtin|内置/)
      expect(() => validateProfilePayload(payload({ id: 'bad id!' }))).toThrow(/id/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('validates payloads', () => {
    expect(() => validateProfilePayload(payload({ name: '  ' }))).toThrow(/name/)
    expect(() => validateProfilePayload(payload({ provider: 'acp' as never }))).toThrow(/provider/)
    expect(() => validateProfilePayload(payload({ reasoningEffort: 'ultra' as never }))).toThrow(/reasoningEffort/)
  })
})
