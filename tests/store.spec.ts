import { describe, expect, it, vi } from 'vitest'
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

function storedProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'custom-1',
    name: 'Custom',
    description: 'A stored custom subagent',
    enabled: true,
    builtin: false,
    provider: 'spawn',
    modelProvider: 'jiyuan',
    model: 'deepseek-v4-flash-0731',
    createdAt: 1,
    updatedAt: 1,
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

  it('refuses to overwrite a corrupt store file on create/update/delete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const corrupt = '{ this is not valid json'
    writeFileSync(path, corrupt, 'utf8')
    const store = new SubagentStore(path)
    try {
      expect(() => store.create(payload())).toThrow(/corrupt/)
      expect(() => store.update('explore', { name: 'Renamed' })).toThrow(/corrupt/)
      expect(() => store.delete('explore')).toThrow(/corrupt/)
      expect(readFileSync(path, 'utf8')).toBe(corrupt)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('treats a profiles array containing null as corrupt and leaves the file untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const malformed = JSON.stringify({ version: 1, profiles: [null] })
    writeFileSync(path, malformed, 'utf8')
    const store = new SubagentStore(path)
    try {
      expect(store.list().map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
      expect(readFileSync(path, 'utf8')).toBe(malformed)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('treats a profiles entry missing id as corrupt and leaves the file untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const malformed = JSON.stringify({ version: 1, profiles: [{ name: 'No id' }] })
    writeFileSync(path, malformed, 'utf8')
    const store = new SubagentStore(path)
    try {
      expect(store.list().map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
      expect(readFileSync(path, 'utf8')).toBe(malformed)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('treats valid JSON with malformed optional fields as corrupt', () => {
    const malformedOptions: Array<Record<string, unknown>> = [
      { toolFilter: { allow: 'read' } },
      { persona: 123 },
      { reasoningEffort: 'ultra' },
      { reasoningEffort: null },
      { maxTokens: -1 },
      { maxTokens: null },
      { maxDepth: 1.5 },
      { maxDepth: null },
      { backgroundMode: 'bad' },
      { backgroundMode: null },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    try {
      for (const override of malformedOptions) {
        const malformed = JSON.stringify({ version: 1, profiles: [storedProfile(override)] })
        writeFileSync(path, malformed, 'utf8')
        const store = new SubagentStore(path)
        expect(store.list().map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
        expect(store.isCorrupt()).toBe(true)
        expect(readFileSync(path, 'utf8')).toBe(malformed)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('treats empty required strings and invalid ids as corrupt', () => {
    const malformedRequired: Array<Record<string, unknown>> = [
      { name: '   ' },
      { name: ' Name ' },
      { description: '' },
      { modelProvider: ' ' },
      { model: '' },
      { id: 'bad id!' },
      { id: '-invalid' },
      { id: ' custom-1 ' },
      { id: 'x'.repeat(65) },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    try {
      for (const override of malformedRequired) {
        const malformed = JSON.stringify({ version: 1, profiles: [storedProfile(override)] })
        writeFileSync(path, malformed, 'utf8')
        const store = new SubagentStore(path)
        expect(store.list().map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
        expect(store.isCorrupt()).toBe(true)
        expect(readFileSync(path, 'utf8')).toBe(malformed)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('strips immutable fields from direct update patches', () => {
    const { store, dir } = tempStore()
    try {
      const before = store.find('explore')
      expect(before).toBeDefined()
      const updated = store.update('explore', { name: 'Renamed Explore', builtin: false, createdAt: 0, updatedAt: 0 } as never)
      expect(updated.builtin).toBe(true)
      expect(updated.createdAt).toBe(before?.createdAt)
      expect(updated.updatedAt).not.toBe(0)
      const raw = JSON.parse(readFileSync(store.path, 'utf8')) as {
        profiles: Array<{ id: string; builtin: boolean; createdAt: number; updatedAt: number }>
      }
      const stored = raw.profiles.find(entry => entry.id === 'explore')
      expect(stored?.builtin).toBe(true)
      expect(stored?.createdAt).toBe(before?.createdAt)
      expect(stored?.updatedAt).toBe(updated.updatedAt)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('treats duplicate profile ids as corrupt and leaves the file untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const malformed = JSON.stringify({ version: 1, profiles: [storedProfile({ id: 'dup' }), storedProfile({ id: 'dup' })] })
    writeFileSync(path, malformed, 'utf8')
    const store = new SubagentStore(path)
    try {
      expect(store.list().map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
      expect(store.isCorrupt()).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe(malformed)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('warns when valid JSON contains invalid profile entries', () => {
    const warn = vi.mocked(console.warn)
    warn.mockClear()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const malformed = JSON.stringify({ version: 1, profiles: [storedProfile({ persona: 123 })] })
    writeFileSync(path, malformed, 'utf8')
    const store = new SubagentStore(path)
    try {
      store.list()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid profile entries'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clears reasoningEffort, maxTokens and maxDepth with null patches', () => {
    const { store, dir } = tempStore()
    try {
      const created = store.create(payload({ id: 'cleared', reasoningEffort: 'high', maxTokens: 123, maxDepth: 4 }))
      expect(created.reasoningEffort).toBe('high')
      expect(created.maxTokens).toBe(123)
      expect(created.maxDepth).toBe(4)

      const updated = store.update('cleared', { reasoningEffort: null, maxTokens: null, maxDepth: null })
      expect(updated.reasoningEffort).toBeUndefined()
      expect(updated.maxTokens).toBeUndefined()
      expect(updated.maxDepth).toBeUndefined()

      const raw = JSON.parse(readFileSync(store.path, 'utf8')) as {
        profiles: Array<{ id: string; reasoningEffort?: unknown; maxTokens?: unknown; maxDepth?: unknown }>
      }
      const stored = raw.profiles.find(entry => entry.id === 'cleared')
      expect(stored?.reasoningEffort).toBeUndefined()
      expect(stored?.maxTokens).toBeUndefined()
      expect(stored?.maxDepth).toBeUndefined()

      expect(() => validateProfilePatch({ reasoningEffort: null, maxTokens: null, maxDepth: null })).not.toThrow()
      expect(validateProfilePayload(payload({ reasoningEffort: null, maxTokens: null, maxDepth: null })).reasoningEffort).toBeUndefined()
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
