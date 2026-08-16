/**
 * Switch: token-styled on/off control built on the same role="switch"
 * track/thumb pattern as TrajectoryToolbar. There is no exported Switch
 * primitive, so this small component owns the official-looking chrome.
 */
import type { ReactNode } from 'react'
import css from './subagents.module.css'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Optional visible label next to the track. */
  label?: ReactNode
  /** Accessible name; defaults to the visible label. */
  ariaLabel?: string
  className?: string
}

/**
 * Render a switch.
 * @param props - checked state, change callback, optional label.
 * @returns the switch button.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  ariaLabel,
  className,
}: SwitchProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      className={className !== undefined ? `${css.switch} ${className}` : css.switch}
      onClick={() => { onChange(!checked) }}
    >
      {label !== undefined && <span className={css.switchLabel}>{label}</span>}
      <span className={css.switchTrack} data-on={checked || undefined} aria-hidden="true">
        <span className={css.switchThumb} />
      </span>
    </button>
  )
}
