import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelThinkingConfig, ModelThinkingVariant } from './protocol.ts'

export interface EffectiveReasoning {
  efforts: readonly ModelThinkingVariant[]
  defaultEffort?: string
}

export function findManualThinkingConfig(
  provider: string,
  model: string,
  configs: readonly ModelThinkingConfig[],
): ModelThinkingConfig | undefined {
  return configs.find(config => config.provider === provider && config.model === model)
}

export function findCatalogReasoning(
  provider: string,
  model: string,
  groups: readonly ModelProviderGroup[],
): EffectiveReasoning | undefined {
  const group = groups.find(entry => entry.id === provider)
  const entry = group?.models.find(candidate => candidate.id === model)
  if (entry?.reasoning === undefined) return undefined
  return {
    efforts: entry.reasoning.efforts.map(effort => ({
      id: effort.id,
      name: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    })),
    ...(entry.reasoning.defaultEffort === undefined ? {} : { defaultEffort: entry.reasoning.defaultEffort }),
  }
}

export function getEffectiveReasoning(
  provider: string,
  model: string,
  manualConfigs: readonly ModelThinkingConfig[],
  groups: readonly ModelProviderGroup[],
): EffectiveReasoning | undefined {
  const manual = findManualThinkingConfig(provider, model, manualConfigs)
  if (manual !== undefined) {
    return {
      efforts: manual.variants,
      ...(manual.defaultVariant === undefined ? {} : { defaultEffort: manual.defaultVariant }),
    }
  }
  return findCatalogReasoning(provider, model, groups)
}

export function getEffectiveDefaultEffort(reasoning: EffectiveReasoning | undefined): string | undefined {
  return reasoning?.defaultEffort
}
