import type { SubagentProfile } from './protocol.ts'

export const BUILTIN_IDS = ['explore', 'general', 'vision'] as const

/** Local environment's default model route used by the builtin seeds. */
const DEFAULT_MODEL_PROVIDER = 'jiyuan'
const DEFAULT_MODEL = 'deepseek-v4-flash-0731'

/**
 * Return the three builtin profiles. The values are user-editable after first
 * write; these seeds only apply when a builtin id is missing from the file.
 * @param now - timestamp shared by all seeds for deterministic tests.
 * @returns the builtin profiles.
 */
export function builtinProfiles(now = Date.now()): SubagentProfile[] {
  const base = {
    enabled: true,
    builtin: true,
    provider: 'spawn',
    modelProvider: DEFAULT_MODEL_PROVIDER,
    model: DEFAULT_MODEL,
    maxTokens: 8192,
    maxDepth: 3,
    backgroundMode: 'one-shot',
    createdAt: now,
    updatedAt: now,
  } as const

  return [
    {
      ...base,
      id: 'explore',
      name: 'Explore',
      description: 'Explore the repository and answer with grounded findings.',
      reasoningEffort: 'high',
      persona: 'You are an exploration subagent. Prefer read-only investigation and concise evidence-based answers.',
      promptTemplate: 'Explore first. Use non-mutating reads, searches, and static analysis to ground the answer.',
      toolFilter: { deny: ['edit', 'write', 'bash', 'pwsh'] },
    },
    {
      ...base,
      id: 'general',
      name: 'General',
      description: 'General-purpose subagent for self-contained tasks.',
      reasoningEffort: 'high',
      persona: 'You are a general-purpose subagent. Complete the assigned task accurately and report the result.',
      promptTemplate: '',
    },
    {
      ...base,
      id: 'vision',
      name: 'Vision',
      description: 'Vision-capable subagent for image understanding and visual analysis.',
      reasoningEffort: 'medium',
      persona: 'You are a vision subagent. When the task involves images, use vision tools to inspect them before answering.',
      promptTemplate: 'Inspect any provided image first, then answer based on what you observe.',
    },
  ]
}
