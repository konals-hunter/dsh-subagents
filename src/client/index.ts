/**
 * Browser-half entry for dsh-subagents. Registers locale dictionaries and the
 * Settings "Subagents" section.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (settings.section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SubagentsApi } from './api.ts'
import { SubagentsSectionController } from './controller.ts'
import { ModelCatalogController } from './ModelCatalogController.ts'
import { PresetCatalogController } from './PresetCatalogController.ts'
import { ToolCatalogController } from './ToolCatalogController.ts'
import { en, NS, zh } from './locales.ts'
import { SubagentsSection, type SubagentsSectionInjected } from './SubagentsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-subagents': keyof typeof zh
  }
}

/** Required services. */
export const inject = ['slots', 'locale', 'connection'] as const

/**
 * Register the Subagents settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-subagents: dictionaries')

  const api = new SubagentsApi()
  const controller = new SubagentsSectionController(api)
  const connection = ctx.get('connection') as ConnectionHandle
  const modelCatalog = new ModelCatalogController(connection.api)
  const presetCatalog = new PresetCatalogController(connection.api)
  const toolCatalog = new ToolCatalogController(api)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'subagents',
    order: 30,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: (): SubagentsSectionInjected => ({
      hooks: {
        subagents: controller.store,
        modelCatalog: modelCatalog.store,
        presetCatalog: presetCatalog.store,
        toolCatalog: toolCatalog.store,
      },
      load: () => controller.load(),
      loadModels: () => modelCatalog.load(),
      loadPresets: () => presetCatalog.load(),
      loadTools: () => toolCatalog.load(),
      create: payload => controller.create(payload),
      update: (id, patch) => controller.update(id, patch),
      remove: id => controller.remove(id),
      restoreBuiltins: () => controller.restoreBuiltins(),
    }),
  }, SubagentsSection))
}
