/**
 * dsh-subagents — host half. Mounts the profile store, loopback REST routes,
 * the subagent_profile tool, and the agent/request reasoningEffort injection.
 * The browser half renders the Settings Subagents section.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import { SubagentStore } from './store.ts'
import { makeRoutes, type LlmDiagnosticFace } from './routes.ts'
import { makeSubagentProfileTool } from './tool.ts'
import { installEffortInjection } from './effort.ts'

/** Stable cordis plugin name. */
export const name = 'dsh-subagents'

/** Services required before the surfaces can mount. */
export const inject = ['webServer', 'tools', 'subagents', 'systemPrompt'] as const

/** Prompt-order slot for the image-reading guidance. */
const IMAGE_GUIDANCE_ORDER = 90

/** Model-facing guidance: use read_image for image paths, not read. */
export const IMAGE_READING_GUIDANCE
  = 'When the user asks you to read, view, or describe an image file path (PNG/JPEG/WebP/GIF), '
    + 'call `read_image` directly with `file_path`. Do not use `read` on binary image files: '
    + '`read` only handles UTF-8 text and will fail with a `binary file` error.'

/**
 * Mount the store, routes, tool, and effort listener. Tool registration is
 * rebuilt whenever the store notifies (REST create/update/delete/restore).
 * @param ctx - host plugin context.
 */
export function apply(ctx: Context): void {
  const store = new SubagentStore()
  store.list()

  const llm = ctx.get('llm') as LlmDiagnosticFace | undefined
  const { routes } = makeRoutes({ store, tools: ctx.tools, llm })

  ctx.effect(() => {
    let disposeTool: (() => void) | undefined
    let syncing = false
    const syncTool = (): void => {
      if (syncing) return
      syncing = true
      try {
        if (disposeTool !== undefined) { disposeTool(); disposeTool = undefined }
        disposeTool = ctx.tools.register(makeSubagentProfileTool({ store, ctx }))
      } finally {
        syncing = false
      }
    }
    const disposers = routes.map(route => ctx.webServer.register(route))
    const disposeEffort = installEffortInjection(ctx, store)
    const disposeImageGuidance = ctx.systemPrompt.section({
      name: 'dsh-subagents:image-reading',
      order: IMAGE_GUIDANCE_ORDER,
      text: IMAGE_READING_GUIDANCE,
    })
    const unsubscribe = store.subscribe(syncTool)
    syncTool()
    return () => {
      for (const dispose of disposers) dispose()
      disposeEffort()
      disposeImageGuidance()
      unsubscribe()
      if (disposeTool !== undefined) disposeTool()
    }
  }, 'dsh-subagents: surfaces')
}

export { SubagentStore } from './store.ts'
export { makeRoutes } from './routes.ts'
export { makeSubagentProfileTool } from './tool.ts'
export { installEffortInjection } from './effort.ts'
