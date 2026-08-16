/**
 * ModelSelect: unified provider + model picker for subagent profiles.
 *
 * Unlike the old two free-text inputs, this control shows one trigger with the
 * current `provider / model` and opens a provider-grouped menu. Choosing a
 * model directly sets both `modelProvider` and `model`.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Menu, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalogState } from './ModelCatalogController.ts'
import css from './subagents.module.css'

export interface ModelSelectProps {
  /** Current profile provider id (e.g. `jiyuan`). */
  modelProvider: string
  /** Current profile model id (e.g. `deepseek-v4-flash-0731`). */
  model: string
  /** Provider groups from the host model catalog. */
  groups: readonly ModelProviderGroup[]
  /** Catalog load state, used for an empty-state label while loading. */
  status?: ModelCatalogState['status']
  /** Disable the trigger. */
  disabled?: boolean
  /** Dense row trigger (default `sm`) or form-sized trigger (`md`). */
  size?: 'sm' | 'md'
  /** Accessible name for the trigger when it is icon/annotation dense. */
  ariaLabel?: string
  /** Called after the user picks a model; receives provider + model ids. */
  onSelect: (modelProvider: string, model: string) => void
}

function modelEntryId(groupIndex: number, modelIndex: number): string {
  return `model-${groupIndex}-${modelIndex}`
}

function parseModelEntryId(id: string): { groupIndex: number; modelIndex: number } | null {
  const match = /^model-(\d+)-(\d+)$/.exec(id)
  if (match === null) return null
  return { groupIndex: Number(match[1]), modelIndex: Number(match[2]) }
}

/**
 * Render the unified provider/model dropdown.
 * @param props - current selection, catalog groups, selection callback.
 * @returns the anchored menu + trigger.
 */
export function ModelSelect({
  modelProvider,
  model,
  groups,
  status = 'idle',
  disabled = false,
  size = 'sm',
  ariaLabel,
  onSelect,
}: ModelSelectProps): ReactNode {
  const [open, setOpen] = useState(false)

  const items: MenuEntry[] = groups.flatMap((group, groupIndex) => {
    const rows: MenuEntry[] = [
      { type: 'label', id: `label-${groupIndex}`, text: group.name },
    ]
    group.models.forEach((modelEntry, modelIndex) => {
      rows.push({
        id: modelEntryId(groupIndex, modelIndex),
        label: (
          <span className={css.modelOption}>
            <span className={css.modelOptionName}>{modelEntry.name}</span>
            <span className={css.modelOptionProvider}>{group.id}</span>
          </span>
        ),
      })
    })
    return rows
  })
  if (groups.length === 0 && status === 'loading') {
    items.push({ type: 'label', id: 'catalog-loading', text: 'Loading…' })
  }
  if (groups.length === 0 && (status === 'ready' || status === 'error')) {
    items.push({ type: 'label', id: 'catalog-empty', text: 'No models available' })
  }

  let selectedId: string | undefined
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]
    if (group.id !== modelProvider) continue
    const modelIndex = group.models.findIndex(entry => entry.id === model)
    if (modelIndex >= 0) {
      selectedId = modelEntryId(groupIndex, modelIndex)
      break
    }
  }

  const handleSelect = (id: string): void => {
    const parsed = parseModelEntryId(id)
    setOpen(false)
    if (parsed === null) return
    const group = groups[parsed.groupIndex]
    const modelEntry = group?.models[parsed.modelIndex]
    if (group === undefined || modelEntry === undefined) return
    onSelect(group.id, modelEntry.id)
  }

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      onSelect={handleSelect}
      selectedId={selectedId}
      items={items}
      dense
      className={css.modelSelect}
      anchor={
        <Button
          variant="outline"
          size={size}
          className={css.modelSelectTrigger}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          <span className={css.selectValue}>{modelProvider} / {model}</span>
          <IconChevronDownOutline14 className={css.selectChevron} />
        </Button>
      }
    />
  )
}
