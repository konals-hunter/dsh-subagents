/**
 * Model-facing subagent_profile tool: one tool whose optional `profile`
 * parameter selects a maintained subagent definition. It calls the same
 * ctx.subagents provider as the official subagent tool, so spawned children
 * are ordinary subagent sessions in the native UI tree.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { settleRun, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { SubagentStore } from './store.ts'
import type { SubagentProfile, ToolFilter } from './protocol.ts'

/** AgentOptions marker used by the effort injection listener. */
export interface SubagentProfileAgentOptions extends AgentOptions {
  subagentProfileId?: string
}

/** Prepend the profile's fixed template to the model prompt. */
export function joinPrompt(template: string | undefined, prompt: string): string {
  const trimmed = template?.trim() ?? ''
  return trimmed === '' ? prompt : trimmed + '\n\n' + prompt
}

/**
 * Resolve the model's call into the fields used to start a child. Pure and
 * testable; execute() applies these to ctx.subagents.
 * @param args - tool arguments.
 * @param profile - matched profile, or undefined for free delegation.
 * @returns the final prompt and child request fields.
 */
export function resolveProfileRequest(
  args: { profile?: string; prompt: string },
  profile: SubagentProfile | undefined,
): {
  prompt: string
  agentOptions: SubagentProfileAgentOptions
  persona?: string
  toolFilter?: ToolFilter
  maxDepth?: number
} {
  const prompt = profile === undefined
    ? args.prompt
    : joinPrompt(profile.promptTemplate, args.prompt)
  const agentOptions: SubagentProfileAgentOptions = {
    ...profile === undefined ? {} : {
      provider: profile.modelProvider,
      model: profile.model,
      subagentProfileId: profile.id,
      ...profile.maxTokens === undefined ? {} : { maxTokens: profile.maxTokens },
    },
  }
  return {
    prompt,
    agentOptions,
    ...profile?.persona !== undefined && profile.persona.trim() !== '' ? { persona: profile.persona } : {},
    ...profile?.toolFilter !== undefined ? { toolFilter: profile.toolFilter } : {},
    ...profile?.maxDepth !== undefined ? { maxDepth: profile.maxDepth } : {},
  }
}

/** Settle a background start into a job outcome (same contract as dsh-tool-subagent). */
async function settleStart(start: Promise<SubagentRun>, signal: AbortSignal): Promise<JobOutcome> {
  try {
    return await settleRun(await start)
  } catch (error: unknown) {
    return signal.aborted
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/**
 * Create the subagent_profile tool definition.
 * @param deps - store used to resolve profiles and build the enum schema, and
 *   the host context used to reach subagents/jobs.
 * @returns the tool definition.
 */
export function makeSubagentProfileTool(deps: { store: SubagentStore; ctx: Context }) {
  const { store, ctx } = deps
  const enabledIds = store.enabledIds()

  return defineTool({
    name: 'subagent_profile',
    description: 'Delegate a task to a maintained subagent profile (Explore, General, Vision, or a custom profile). ' +
      'Each profile fixes a model, thinking variant, persona, and optional tool restrictions. ' +
      'When `profile` is omitted this behaves like the plain subagent tool using the parent defaults. ' +
      'Spawned children appear in the normal subagent UI.',
    parameters: {
      ...(enabledIds.length > 0 ? {
        profile: {
          type: 'string',
          enum: enabledIds,
          description: 'Maintained subagent profile id to use; omit for free delegation.',
        },
      } : {}),
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete, self-contained task for the subagent.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Whether to run a one-shot profile in the background. Defaults to false; continuable profiles always run as continuable subagents.',
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
        ],
      },
      render: (_args, value: { kind: string; output?: JsonValue[]; jobId?: string; subagentId?: string }) => {
        if (value.kind === 'background') return text('started background subagent task ' + value.jobId)
        if (value.kind === 'continuable') return text('started subagent ' + value.subagentId)
        const output = value.output ?? []
        const parts = (output as unknown as ContentBlock[])
          .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
          .map(block => block.text)
          .join('')
        return text(parts)
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: { profile?: string; prompt: string; run_in_background?: boolean }, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('subagent_profile requires a calling agent')
      const profile = args.profile === undefined ? undefined : store.find(args.profile)
      if (args.profile !== undefined && profile === undefined) throw new Error('subagent profile not found: ' + args.profile)
      if (profile !== undefined && !profile.enabled) throw new Error('subagent profile is disabled: ' + profile.id)
      const resolved = resolveProfileRequest(args, profile)
      const provider = profile?.provider ?? 'spawn'
      const backgroundMode = profile?.backgroundMode ?? 'one-shot'
      const runInBackground = args.run_in_background ?? false

      const request = {
        label: profile?.name ?? args.prompt.slice(0, 80),
        prompt: [{ type: 'text', text: resolved.prompt }] as ContentBlock[],
        parent,
        agentOptions: resolved.agentOptions as AgentOptions,
        ...resolved.persona !== undefined ? { persona: resolved.persona } : {},
        ...resolved.toolFilter !== undefined ? { toolFilter: resolved.toolFilter } : {},
        ...resolved.maxDepth !== undefined ? { maxDepth: resolved.maxDepth } : {},
      }

      if (backgroundMode === 'continuable') {
        const started = await ctx.subagents.startContinuable({
          provider,
          label: request.label,
          request: {
            prompt: request.prompt,
            parent: request.parent,
            agentOptions: request.agentOptions,
            ...request.persona !== undefined ? { persona: request.persona } : {},
            ...request.toolFilter !== undefined ? { toolFilter: request.toolFilter } : {},
            ...request.maxDepth !== undefined ? { maxDepth: request.maxDepth } : {},
          },
          signal: exec.signal,
        })
        return { kind: 'continuable' as const, subagentId: started.childId }
      }

      if (runInBackground) {
        const jobs = ctx.get('jobs')
        if (jobs === undefined) throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        const id = jobs.start({
          kind: 'subagent',
          label: request.label,
          owner: parent,
          run: () => {
            const controller = new AbortController()
            const start = ctx.subagents.start(provider, { ...request, signal: controller.signal })
            return {
              cancel: (reason?: string) => { controller.abort(reason ?? 'background subagent task killed') },
              done: settleStart(start, controller.signal),
            }
          },
        })
        return { kind: 'background' as const, jobId: id }
      }

      const run = await ctx.subagents.start(provider, { ...request, signal: exec.signal })
      try {
        const result = await run.result
        if (result.stopReason !== 'completed') throw new Error('subagent run ended abnormally: ' + result.stopReason)
        return { kind: 'foreground' as const, runId: run.id, output: result.output as unknown as JsonValue[] }
      } finally {
        await run.dispose()
      }
    },
  })
}
