/**
 * EffortSelect: Thinking Variant selector for subagent profiles.
 *
 * Renders a compact Button trigger plus Menu, matching the other official
 * settings controls instead of a native `<select>`.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Menu, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReasoningEffort } from '../protocol.ts'
import css from './subagents.module.css'

export interface EffortOption {
  value: ReasoningEffort | null
  label: string
}

export interface EffortSelectProps {
  /** Current profile reasoningEffort; `null`/`undefined` means provider default. */
  value: ReasoningEffort | null | undefined
  /** Localized option rows (including the default/null entry). */
  options: readonly EffortOption[]
  /** Called after the user picks an option. */
  onChange: (value: ReasoningEffort | null) => void
  /** Disable the trigger. */
  disabled?: boolean
  /** Dense row trigger (default `sm`) or form-sized trigger (`md`). */
  size?: 'sm' | 'md'
  /** Accessible name for the trigger. */
  ariaLabel?: string
}

function optionId(option: EffortOption): string {
  return option.value === null ? 'default' : option.value
}

/**
 * Render the Thinking Variant dropdown.
 * @param props - current value, options, callback.
 * @returns the anchored menu + trigger.
 */
export function EffortSelect({
  value,
  options,
  onChange,
  disabled = false,
  size = 'sm',
  ariaLabel,
}: EffortSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const current = options.find(option => (option.value ?? null) === (value ?? null))
  const currentLabel = current?.label ?? (value === null || value === undefined ? 'Default' : value)

  const items: MenuEntry[] = options.map(option => ({
    id: optionId(option),
    label: <span className={css.effortOption}>{option.label}</span>,
  }))

  const handleSelect = (id: string): void => {
    setOpen(false)
    const option = options.find(entry => optionId(entry) === id)
    if (option !== undefined) onChange(option.value)
  }

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      onSelect={handleSelect}
      selectedId={value ?? 'default'}
      items={items}
      dense
      className={css.effortSelect}
      anchor={
        <Button
          variant="outline"
          size={size}
          className={css.effortSelectTrigger}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          <span className={css.selectValue}>{currentLabel}</span>
          <IconChevronDownOutline14 className={css.selectChevron} />
        </Button>
      }
    />
  )
}
