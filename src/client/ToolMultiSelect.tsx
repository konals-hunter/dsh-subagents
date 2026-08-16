/**
 * ToolMultiSelect: official-style multi-select dropdown for tool names.
 *
 * Selecting an item toggles it in the array and keeps the menu open so users
 * can pick multiple tools before dismissing the menu.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Menu, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './subagents.module.css'

export interface ToolMultiSelectProps {
  /** Currently selected tool names. */
  value: readonly string[]
  /** All available tool names. */
  tools: readonly string[]
  /** Called with the next selection array after a toggle. */
  onChange: (next: string[]) => void
  /** Dense row trigger (default `md`) or smaller trigger (`sm`). */
  size?: 'sm' | 'md'
  /** Shown when no tools are selected. */
  placeholder?: string
  /** Accessible name for the trigger. */
  ariaLabel?: string
  /** Disable the trigger. */
  disabled?: boolean
}

/**
 * Render a compact menu-based multi-select for tool names.
 * @param props - current selection, available tools, callback.
 * @returns the anchored menu + trigger.
 */
export function ToolMultiSelect({
  value,
  tools,
  onChange,
  size = 'md',
  placeholder = 'Select tools',
  ariaLabel,
  disabled = false,
}: ToolMultiSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const selectedCount = value.length

  const label = selectedCount === 0
    ? placeholder
    : selectedCount <= 2
      ? value.join(', ')
      : `${selectedCount} selected`

  const items: MenuEntry[] = tools.map(tool => ({
    id: tool,
    label: <span className={css.effortOption}>{tool}</span>,
  }))

  const handleSelect = (id: string): void => {
    const next = value.includes(id)
      ? value.filter(item => item !== id)
      : [...value, id]
    onChange(next)
  }

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      onSelect={handleSelect}
      selectedIds={value}
      items={items}
      dense
      className={css.toolSelect}
      anchor={
        <Button
          variant="outline"
          size={size}
          className={css.toolSelectTrigger}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          <span className={css.selectValue}>{label}</span>
          <IconChevronDownOutline14 className={css.selectChevron} />
        </Button>
      }
    />
  )
}
