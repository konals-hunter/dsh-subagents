/**
 * Subagent profile store: one JSON file (~/.dsh/dsh-subagents.json) holding
 * builtin and custom profiles, written atomically (tmp + rename). Builtins are
 * merged on read/restore but never overwrite user edits.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { BUILTIN_IDS, builtinProfiles } from './builtins.ts'
import type {
  ReasoningEffort,
  SubagentProfile,
  SubagentProfilePatch,
  SubagentProfilePayload,
  ToolFilter,
} from './protocol.ts'

/** File format version. */
const FORMAT_VERSION = 1

/** Store file location: <home>/.dsh/dsh-subagents.json. */
export function storePath(): string {
  return join(homedir(), '.dsh', 'dsh-subagents.json')
}

interface StoreFile {
  version: number
  profiles: SubagentProfile[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStoredNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value !== ''
}

function isStoredProfile(value: unknown): value is SubagentProfile {
  if (!isRecord(value)) return false
  if (!isStoredNonEmptyString(value.id) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.id)) return false
  if (!isStoredNonEmptyString(value.name) || !isStoredNonEmptyString(value.description)) return false
  if (value.provider !== 'spawn' && value.provider !== 'fork') return false
  if (!isStoredNonEmptyString(value.modelProvider) || !isStoredNonEmptyString(value.model)) return false
  if (typeof value.enabled !== 'boolean' || typeof value.builtin !== 'boolean') return false
  if (value.builtin !== (BUILTIN_IDS as readonly string[]).includes(value.id)) return false
  if (
    typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 ||
    typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 ||
    value.updatedAt < value.createdAt
  ) return false
  if (value.backgroundMode !== undefined && value.backgroundMode !== 'one-shot' && value.backgroundMode !== 'continuable') return false
  try {
    if (value.reasoningEffort !== undefined && parseReasoningEffort(value.reasoningEffort) === undefined) return false
    if (value.maxTokens !== undefined && parseOptionalNumber(value.maxTokens, 'maxTokens') === undefined) return false
    if (value.maxDepth !== undefined && parseOptionalNumber(value.maxDepth, 'maxDepth') === undefined) return false
    if (value.persona !== undefined && parseOptionalString(value.persona, 'persona') === undefined) return false
    if (value.promptTemplate !== undefined && parseOptionalString(value.promptTemplate, 'promptTemplate') === undefined) return false
    if (value.toolFilter !== undefined && parseToolFilter(value.toolFilter) === undefined) return false
  } catch {
    return false
  }
  return true
}

function hasDuplicateIds(profiles: SubagentProfile[]): boolean {
  const seen = new Set<string>()
  for (const profile of profiles) {
    if (seen.has(profile.id)) return true
    seen.add(profile.id)
  }
  return false
}

function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === null) return undefined
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'max') return value
  throw new Error('reasoningEffort must be off, low, medium, high or max')
}

function parseToolFilter(value: unknown): ToolFilter | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new Error('toolFilter must be an object')
  const allow = value.allow
  const deny = value.deny
  if (allow !== undefined && (!Array.isArray(allow) || allow.some(item => typeof item !== 'string'))) {
    throw new Error('toolFilter.allow must be an array of strings')
  }
  if (deny !== undefined && (!Array.isArray(deny) || deny.some(item => typeof item !== 'string'))) {
    throw new Error('toolFilter.deny must be an array of strings')
  }
  const normalized: ToolFilter = {}
  if (allow !== undefined && allow.some(item => item.trim() !== '')) {
    normalized.allow = allow.map(item => item.trim()).filter(item => item !== '')
  }
  if (deny !== undefined && deny.some(item => item.trim() !== '')) {
    normalized.deny = deny.map(item => item.trim()).filter(item => item !== '')
  }
  if (normalized.allow === undefined && normalized.deny === undefined) throw new Error('toolFilter must name allow or deny')
  return normalized
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(field + ' must be a string')
  return value.trim()
}

function parseOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(field + ' must be a non-negative safe integer')
  return value
}

function sameToolFilter(left: ToolFilter | undefined, right: ToolFilter | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return (
    (left.allow === undefined) === (right.allow === undefined) &&
    (left.deny === undefined) === (right.deny === undefined) &&
    (left.allow ?? []).length === (right.allow ?? []).length &&
    (left.deny ?? []).length === (right.deny ?? []).length &&
    (left.allow ?? []).every((item, index) => item === right.allow?.[index]) &&
    (left.deny ?? []).every((item, index) => item === right.deny?.[index])
  )
}

function normalizeToolFilter(toolFilter: ToolFilter): ToolFilter | undefined {
  const allow = toolFilter.allow?.map(item => item.trim()).filter(item => item !== '')
  const deny = toolFilter.deny?.map(item => item.trim()).filter(item => item !== '')
  const next: ToolFilter = {}
  if (allow !== undefined && allow.length > 0) next.allow = allow
  if (deny !== undefined && deny.length > 0) next.deny = deny
  return sameToolFilter(next, toolFilter) ? undefined : next
}

/** Trim optional strings/toolFilter arrays on stored profiles while keeping validated required fields untouched. */
function normalizeStoredProfile(profile: SubagentProfile): SubagentProfile {
  const next = { ...profile }
  let changed = false
  if (profile.persona !== undefined && profile.persona !== profile.persona.trim()) {
    next.persona = profile.persona.trim()
    changed = true
  }
  if (profile.promptTemplate !== undefined && profile.promptTemplate !== profile.promptTemplate.trim()) {
    next.promptTemplate = profile.promptTemplate.trim()
    changed = true
  }
  if (profile.toolFilter !== undefined) {
    const normalizedToolFilter = normalizeToolFilter(profile.toolFilter)
    if (normalizedToolFilter !== undefined) {
      next.toolFilter = normalizedToolFilter
      changed = true
    }
  }
  return changed ? next : profile
}

/** Validate and normalize a create payload. */
export function validateProfilePayload(payload: unknown): SubagentProfilePayload {
  if (!isRecord(payload)) throw new Error('body must be a JSON object')
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new Error('id must match ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$')
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (name === '') throw new Error('name is required')
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  if (description === '') throw new Error('description is required')
  const provider = payload.provider
  if (provider !== 'spawn' && provider !== 'fork') throw new Error('provider must be spawn or fork')
  const modelProvider = typeof payload.modelProvider === 'string' ? payload.modelProvider.trim() : ''
  if (modelProvider === '') throw new Error('modelProvider is required')
  const model = typeof payload.model === 'string' ? payload.model.trim() : ''
  if (model === '') throw new Error('model is required')
  const backgroundMode = payload.backgroundMode === undefined || payload.backgroundMode === null
    ? 'one-shot'
    : payload.backgroundMode
  if (backgroundMode !== 'one-shot' && backgroundMode !== 'continuable') throw new Error('backgroundMode must be one-shot or continuable')
  const enabled = payload.enabled
  if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
  return {
    id,
    name,
    description,
    enabled,
    provider,
    modelProvider,
    model,
    reasoningEffort: parseReasoningEffort(payload.reasoningEffort),
    maxTokens: parseOptionalNumber(payload.maxTokens, 'maxTokens'),
    maxDepth: parseOptionalNumber(payload.maxDepth, 'maxDepth'),
    persona: parseOptionalString(payload.persona, 'persona'),
    promptTemplate: parseOptionalString(payload.promptTemplate, 'promptTemplate'),
    toolFilter: parseToolFilter(payload.toolFilter),
    backgroundMode,
  }
}

/** Validate and normalize a partial update. */
export function validateProfilePatch(payload: unknown): SubagentProfilePatch {
  if (!isRecord(payload)) throw new Error('body must be a JSON object')
  const patch: SubagentProfilePatch = {}
  if (payload.id !== undefined) throw new Error('id cannot be changed')
  if (payload.name !== undefined) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (name === '') throw new Error('name is required')
    patch.name = name
  }
  if (payload.description !== undefined) {
    const description = typeof payload.description === 'string' ? payload.description.trim() : ''
    if (description === '') throw new Error('description is required')
    patch.description = description
  }
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    patch.enabled = payload.enabled
  }
  if (payload.provider !== undefined) {
    if (payload.provider !== 'spawn' && payload.provider !== 'fork') throw new Error('provider must be spawn or fork')
    patch.provider = payload.provider
  }
  if (payload.modelProvider !== undefined) {
    const modelProvider = typeof payload.modelProvider === 'string' ? payload.modelProvider.trim() : ''
    if (modelProvider === '') throw new Error('modelProvider is required')
    patch.modelProvider = modelProvider
  }
  if (payload.model !== undefined) {
    const model = typeof payload.model === 'string' ? payload.model.trim() : ''
    if (model === '') throw new Error('model is required')
    patch.model = model
  }
  if (payload.reasoningEffort !== undefined) patch.reasoningEffort = parseReasoningEffort(payload.reasoningEffort)
  if (payload.maxTokens !== undefined) patch.maxTokens = parseOptionalNumber(payload.maxTokens, 'maxTokens')
  if (payload.maxDepth !== undefined) patch.maxDepth = parseOptionalNumber(payload.maxDepth, 'maxDepth')
  if (payload.persona !== undefined) patch.persona = parseOptionalString(payload.persona, 'persona')
  if (payload.promptTemplate !== undefined) patch.promptTemplate = parseOptionalString(payload.promptTemplate, 'promptTemplate')
  if (payload.toolFilter !== undefined) patch.toolFilter = parseToolFilter(payload.toolFilter)
  if (payload.backgroundMode !== undefined) {
    if (payload.backgroundMode !== 'one-shot' && payload.backgroundMode !== 'continuable') throw new Error('backgroundMode must be one-shot or continuable')
    patch.backgroundMode = payload.backgroundMode
  }
  return patch
}

/** The subagent profile store. Pure file I/O plus a simple subscriber list. */
export class SubagentStore {
  readonly path: string
  private readonly listeners = new Set<() => void>()

  constructor(path?: string) {
    this.path = resolve(path ?? storePath())
  }

  private corrupt = false

  private load(): { file: StoreFile; corrupt: boolean } {
    if (!existsSync(this.path)) return { file: { version: FORMAT_VERSION, profiles: [] }, corrupt: false }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!isRecord(parsed) || !Array.isArray(parsed.profiles) || parsed.version !== FORMAT_VERSION || !parsed.profiles.every(isStoredProfile) || hasDuplicateIds(parsed.profiles as SubagentProfile[])) {
        console.warn('[dsh-subagents] profile store contains invalid profile entries; refusing to overwrite ' + this.path)
        return { file: { version: FORMAT_VERSION, profiles: [] }, corrupt: true }
      }
      return { file: parsed as unknown as StoreFile, corrupt: false }
    } catch (error) {
      console.warn('[dsh-subagents] profile store unreadable, starting empty:', error)
      return { file: { version: FORMAT_VERSION, profiles: [] }, corrupt: true }
    }
  }

  private save(file: StoreFile): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const tmp = this.path + '.tmp'
    writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  private assertWritable(): void {
    if (this.corrupt) throw new Error('profile store is corrupt; refusing to overwrite ' + this.path)
  }

  isCorrupt(): boolean {
    return this.corrupt
  }

  private read(): StoreFile {
    const { file, corrupt } = this.load()
    this.corrupt = corrupt
    const builtins = builtinProfiles()
    let changed = false
    for (const builtin of builtins) {
      if (!file.profiles.some(profile => profile.id === builtin.id)) {
        file.profiles.push(builtin)
        changed = true
      }
    }
    const normalizedProfiles = file.profiles.map(normalizeStoredProfile)
    if (normalizedProfiles.some((profile, index) => profile !== file.profiles[index])) {
      file.profiles = normalizedProfiles
      changed = true
    }
    if (changed && !corrupt) this.save(file)
    return file
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  list(): SubagentProfile[] {
    return this.read().profiles
  }

  find(id: string): SubagentProfile | undefined {
    return this.read().profiles.find(profile => profile.id === id)
  }

  create(payload: SubagentProfilePayload): SubagentProfile {
    const normalizedPayload = validateProfilePayload(payload)
    const file = this.read()
    this.assertWritable()
    if (file.profiles.some(profile => profile.id === normalizedPayload.id)) throw new Error('id already exists: ' + normalizedPayload.id)
    const now = Date.now()
    const profile: SubagentProfile = {
      ...normalizedPayload,
      reasoningEffort: normalizedPayload.reasoningEffort ?? undefined,
      maxTokens: normalizedPayload.maxTokens ?? undefined,
      maxDepth: normalizedPayload.maxDepth ?? undefined,
      toolFilter: normalizedPayload.toolFilter ?? undefined,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    }
    file.profiles.push(profile)
    this.save(file)
    this.notify()
    return profile
  }

  update(id: string, patch: SubagentProfilePatch): SubagentProfile {
    const editable = { ...patch } as Record<string, unknown>
    delete editable.id
    delete editable.builtin
    delete editable.createdAt
    delete editable.updatedAt
    const normalizedPatch = validateProfilePatch(editable)
    const file = this.read()
    this.assertWritable()
    const profile = file.profiles.find(entry => entry.id === id)
    if (profile === undefined) throw new Error('profile not found: ' + id)
    const { toolFilter, reasoningEffort, maxTokens, maxDepth, ...rest } = normalizedPatch
    Object.assign(profile, rest)
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'toolFilter')) {
      profile.toolFilter = toolFilter ?? undefined
    }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'reasoningEffort')) {
      profile.reasoningEffort = reasoningEffort ?? undefined
    }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'maxTokens')) {
      profile.maxTokens = maxTokens ?? undefined
    }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'maxDepth')) {
      profile.maxDepth = maxDepth ?? undefined
    }
    profile.updatedAt = Date.now()
    this.save(file)
    this.notify()
    return profile
  }

  delete(id: string): void {
    const file = this.read()
    this.assertWritable()
    const index = file.profiles.findIndex(profile => profile.id === id)
    if (index < 0) throw new Error('profile not found: ' + id)
    if (file.profiles[index].builtin) throw new Error('builtin profile cannot be deleted')
    file.profiles.splice(index, 1)
    this.save(file)
    this.notify()
  }

  restoreBuiltins(): SubagentProfile[] {
    const file = this.read()
    if (!this.corrupt) this.save(file)
    this.notify()
    return file.profiles
  }

  /** Exposed for the tool schema: only enabled profiles are delegatable. */
  enabledIds(): string[] {
    return this.list().filter(profile => profile.enabled).map(profile => profile.id)
  }
}

/** Re-export for callers that only need the builtin id list. */
export { BUILTIN_IDS }
