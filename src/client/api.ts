/** Browser-side API client for the /api/dsh-subagents route family. */
import {
  SUBAGENTS_API,
  type SubagentProfile,
  type SubagentProfilePatch,
  type SubagentProfilePayload,
} from '../protocol.ts'

export interface ProfilesResponse {
  profiles: SubagentProfile[]
  corrupt?: boolean
}

export interface ToolsResponse {
  tools: string[]
}

export interface RestoreBuiltinsResponse extends ProfilesResponse {
  error?: string
}

export class SubagentsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubagentsApiError'
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try { body = await response.json() } catch { throw new SubagentsApiError('HTTP ' + response.status + ': invalid JSON response') }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'HTTP ' + response.status
    throw new SubagentsApiError(message)
  }
  return body as T
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? '' : '?' + text
}

/** The browser half's only data entry point. */
export class SubagentsApi {
  async listProfiles(): Promise<ProfilesResponse> {
    const response = await fetch(SUBAGENTS_API.profiles)
    return await readJson<ProfilesResponse>(response)
  }

  async createProfile(payload: SubagentProfilePayload): Promise<SubagentProfile> {
    const response = await fetch(SUBAGENTS_API.profiles, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await readJson<{ profile: SubagentProfile }>(response)
    return body.profile
  }

  async updateProfile(id: string, patch: SubagentProfilePatch): Promise<SubagentProfile> {
    const response = await fetch(SUBAGENTS_API.profiles + query({ id }), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await readJson<{ profile: SubagentProfile }>(response)
    return body.profile
  }

  async deleteProfile(id: string): Promise<void> {
    const response = await fetch(SUBAGENTS_API.profiles + query({ id }), { method: 'DELETE' })
    await readJson<{ ok: boolean }>(response)
  }

  async restoreBuiltins(): Promise<RestoreBuiltinsResponse> {
    const response = await fetch(SUBAGENTS_API.restoreBuiltins, { method: 'POST' })
    return await readJson<RestoreBuiltinsResponse>(response)
  }

  async listTools(): Promise<ToolsResponse> {
    const response = await fetch(SUBAGENTS_API.tools)
    return await readJson<ToolsResponse>(response)
  }
}
