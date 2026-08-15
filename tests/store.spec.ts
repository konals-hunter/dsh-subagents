import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SubagentStore, validateProfilePatch, validateProfilePayload } from '../src/store.ts'
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

  it('clears toolFilter with null and accepts it in patches', () => {
    const { store, dir } = tempStore()
    try {
      const created = store.create(payload({ id: 'filtered', toolFilter: { allow: ['read'] } }))
      expect(created.toolFilter).toEqual({ allow: ['read'] })
      const updated = store.update('filtered', { toolFilter: null })
      expect(updated.toolFilter).toBeUndefined()
      expect(() => validateProfilePatch({ toolFilter: null })).not.toThrow()
      const raw = JSON.parse(readFileSync(store.path, 'utf8')) as { profiles: Array<{ id: string; toolFilter?: unknown }> }
      expect(raw.profiles.find(entry => entry.id === 'filtered')?.toolFilter).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('preserves toolFilter on partial updates that do not mention it', () => {
    const { store, dir } = tempStore()
    try {
      const created = store.create(payload({ id: 'filtered', toolFilter: { deny: ['edit'] } }))
      expect(created.toolFilter).toEqual({ deny: ['edit'] })
      const updated = store.update('filtered', { model: 'deepseek-v4-pro' })
      expect(updated.toolFilter).toEqual({ deny: ['edit'] })
      const raw = JSON.parse(readFileSync(store.path, 'utf8')) as { profiles: Array<{ id: string; toolFilter?: unknown }> }
      expect(raw.profiles.find(entry => entry.id === 'filtered')?.toolFilter).toEqual({ deny: ['edit'] })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not overwrite a corrupt store file when listing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const corrupt = '{ this is not valid json'
    writeFileSync(path, corrupt, 'utf8')
    const store = new SubagentStore(path)
    try {
      expect(store.list().map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
      expect(readFileSync(path, 'utf8')).toBe(corrupt)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not overwrite a corrupt store file when restoring builtins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const corrupt = '{ this is not valid json'
    writeFileSync(path, corrupt, 'utf8')
    const store = new SubagentStore(path)
    try {
      expect(store.restoreBuiltins().map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
      expect(readFileSync(path, 'utf8')).toBe(corrupt)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('trims tool filter entries and requires boolean enabled', () => {
    const normalized = validateProfilePayload(payload({
      enabled: true,
      toolFilter: { allow: [' read ', '', 'write '], deny: ['', ' edit '] },
    }))
    expect(normalized.toolFilter).toEqual({ allow: ['read', 'write'], deny: ['edit'] })
    expect(() => validateProfilePayload(payload({ enabled: 'yes' as never }))).toThrow(/enabled/)
    expect(() => validateProfilePayload(payload({ toolFilter: {} }))).toThrow(/allow or deny/)
    expect(() => validateProfilePayload(payload({ toolFilter: { allow: [], deny: [] } }))).toThrow(/allow or deny/)
  })
})
