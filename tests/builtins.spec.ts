import { describe, expect, it } from 'vitest'
import { BUILTIN_IDS, builtinProfiles } from '../src/builtins.ts'

describe('builtinProfiles', () => {
  it('creates explore/general/vision with stable ids and builtin flags', () => {
    const profiles = builtinProfiles(123)
    expect(profiles.map(p => p.id)).toEqual(['explore', 'general', 'vision'])
    expect(profiles.every(p => p.builtin === true)).toBe(true)
    expect(profiles.every(p => p.enabled === true)).toBe(true)
    expect(profiles.every(p => p.provider === 'spawn')).toBe(true)
    expect(profiles.every(p => p.createdAt === 123 && p.updatedAt === 123)).toBe(true)
    expect(BUILTIN_IDS).toEqual(['explore', 'general', 'vision'])
  })
})
