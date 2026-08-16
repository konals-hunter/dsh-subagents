/**
 * MenuSelect: generic compact dropdown for simple enum choices (spawn/fork,
 * background mode, etc.). Uses Button + Menu so every settings control shares
 * the official DSH look instead of a native `<select>`.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Menu, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './subagents.module.css'

export interface MenuSelectOption {
  value: string
  label: ReactNode
}

export interface MenuSelectProps {
  /** Current raw value. */
  value: string
  /** Available choices. */
  options: readonly MenuSelectOption[]
  /** Called after the user picks an option. */
  onChange: (value: string) => void
  /** Disable the trigger. */
  disabled?: boolean
  /** Dense row trigger (default `sm`) or form-sized trigger (`md`). */
  size?: 'sm' | 'md'
  /** Accessible name for the trigger. */
  ariaLabel?: string
}

/**
 * Render a compact menu-based enum selector.
 * @param props - current value, options, callback.
 * @returns the anchored menu + trigger.
 */
export function MenuSelect({
  value,
  options,
  onChange,
  disabled = false,
  size = 'sm',
  ariaLabel,
}: MenuSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.value === value)
  const items: MenuEntry[] = options.map(option => ({
    id: option.value,
    label: <span className={css.effortOption}>{option.label}</span>,
  }))

  const handleSelect = (id: string): void => {
    setOpen(false)
    const option = options.find(entry => entry.value === id)
    if (option !== undefined) onChange(option.value)
  }

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      onSelect={handleSelect}
      selectedId={value}
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
          <span className={css.selectValue}>{current?.label ?? value}</span>
          <IconChevronDownOutline14 className={css.selectChevron} />
        </Button>
      }
    />
  )
}
