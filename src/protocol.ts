/** Shared wire types for the dsh-subagents plugin (host + browser halves). */

/** Adapter 的 opaque thinking variant id；undefined 表示跟随模型默认。 */
export type ReasoningEffort = string

export interface ModelThinkingVariant {
  id: string
  name: string
  description?: string
}

export interface ModelThinkingConfig {
  provider: string
  model: string
  variants: ModelThinkingVariant[]
  defaultVariant?: string
}

export interface ModelThinkingConfigPatch {
  variants?: ModelThinkingVariant[]
  defaultVariant?: string | null
}

export type SubagentProviderName = 'spawn' | 'fork'

export type SubagentBackgroundMode = 'one-shot' | 'continuable'

/** Child tool scoping, same shape as dsh-tool-subagent's toolFilter. */
export interface ToolFilter {
  allow?: string[]
  deny?: string[]
}

/** One stored subagent profile. */
export interface SubagentProfile {
  id: string
  name: string
  description: string
  enabled: boolean
  builtin: boolean
  provider: SubagentProviderName
  modelProvider: string
  model: string
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  maxDepth?: number
  persona?: string
  promptTemplate?: string
  toolFilter?: ToolFilter
  backgroundMode?: SubagentBackgroundMode
  preset?: string | null
  createdAt: number
  updatedAt: number
}

/** Payload accepted by create; id is user-supplied and immutable afterwards. */
export interface SubagentProfilePayload {
  id: string
  name: string
  description: string
  enabled: boolean
  provider: SubagentProviderName
  modelProvider: string
  model: string
  reasoningEffort?: ReasoningEffort | null
  maxTokens?: number | null
  maxDepth?: number | null
  persona?: string
  promptTemplate?: string
  toolFilter?: ToolFilter | null
  backgroundMode?: SubagentBackgroundMode
  preset?: string | null
}

/** Partial update accepted by PUT. */
export type SubagentProfilePatch = Partial<SubagentProfilePayload>

/** Route family constants shared with the browser half. */
export const SUBAGENTS_API = {
  profiles: '/api/dsh-subagents/profiles',
  restoreBuiltins: '/api/dsh-subagents/profiles/restore-builtins',
  tools: '/api/dsh-subagents/tools',
  modelInfo: '/api/dsh-subagents/model-info',
  thinkingConfigs: '/api/dsh-subagents/thinking-configs',
} as const
