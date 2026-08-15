/**
 * Settings section for Subagents: list, inline edit form, add custom, delete
 * custom, and restore builtins.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings-surface SlotMap merge (settings.section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentProfile, SubagentProfilePatch, SubagentProfilePayload, ToolFilter } from '../protocol.ts'
import type { SubagentsSectionState } from './controller.ts'
import { NS } from './locales.ts'
import css from './subagents.module.css'

/** Registration-side business face for the settings section. */
export interface SubagentsSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useSubagents. */
    subagents: SnapshotStore<SubagentsSectionState>
  }
  load: () => Promise<void>
  create: (payload: SubagentProfilePayload) => Promise<void>
  update: (id: string, patch: SubagentProfilePatch) => Promise<void>
  remove: (id: string) => Promise<void>
  restoreBuiltins: () => Promise<void>
}

/** Full component props. */
export type SubagentsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<SubagentsSectionInjected>

type Draft = Partial<SubagentProfilePayload> & { id: string }

function blankDraft(): Draft {
  return {
    id: '',
    name: '',
    description: '',
    enabled: true,
    provider: 'spawn',
    modelProvider: '',
    model: '',
    backgroundMode: 'one-shot',
  }
}

function toDraft(profile: SubagentProfile): Draft {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    enabled: profile.enabled,
    provider: profile.provider,
    modelProvider: profile.modelProvider,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort,
    maxTokens: profile.maxTokens,
    maxDepth: profile.maxDepth,
    persona: profile.persona,
    promptTemplate: profile.promptTemplate,
    toolFilter: profile.toolFilter,
    backgroundMode: profile.backgroundMode ?? 'one-shot',
  }
}

function parseCommaList(value: string): string[] | undefined {
  const items = value.split(',').map(item => item.trim()).filter(item => item !== '')
  return items.length === 0 ? undefined : items
}

function normalizeToolFilterDraft(value: ToolFilter | null | undefined): ToolFilter | null {
  const allow = value?.allow?.filter(item => item.trim() !== '').map(item => item.trim())
  const deny = value?.deny?.filter(item => item.trim() !== '').map(item => item.trim())
  if ((allow === undefined || allow.length === 0) && (deny === undefined || deny.length === 0)) return null
  return {
    ...allow !== undefined && allow.length > 0 ? { allow } : {},
    ...deny !== undefined && deny.length > 0 ? { deny } : {},
  }
}

/**
 * Render the Subagents settings section.
 * @param props - composed slot props.
 * @returns the section.
 */
export function SubagentsSection(props: SubagentsSectionProps): ReactNode {
  const { useSubagents, t, load, create, update, remove, restoreBuiltins } = props
  const state = useSubagents(snapshot => snapshot)
  const [editing, setEditing] = useState<{ mode: 'new' } | { mode: 'edit'; profile: SubagentProfile } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void load() }, [load])

  if (state.status === 'error') {
    return <div className={css.section}><p className={css.error}>{t('error.load')} {state.error}</p></div>
  }
  if (state.status === 'loading') return <div className={css.section}>{t('nav')}...</div>

  const openNew = (): void => {
    setEditing({ mode: 'new' })
    setDraft(blankDraft())
    setError(null)
  }
  const openEdit = (profile: SubagentProfile): void => {
    setEditing({ mode: 'edit', profile })
    setDraft(toDraft(profile))
    setError(null)
  }
  const close = (): void => {
    setEditing(null)
    setDraft(null)
    setError(null)
  }
  const save = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    setError(null)
    try {
      if (editing?.mode === 'new') {
        await create({ ...draft, toolFilter: normalizeToolFilterDraft(draft.toolFilter) } as SubagentProfilePayload)
      } else if (editing?.mode === 'edit' && editing.profile !== undefined) {
        await update(editing.profile.id, {
          name: draft.name,
          description: draft.description,
          enabled: draft.enabled,
          provider: draft.provider,
          modelProvider: draft.modelProvider,
          model: draft.model,
          reasoningEffort: draft.reasoningEffort,
          maxTokens: draft.maxTokens,
          maxDepth: draft.maxDepth,
          persona: draft.persona,
          promptTemplate: draft.promptTemplate,
          toolFilter: normalizeToolFilterDraft(draft.toolFilter),
          backgroundMode: draft.backgroundMode,
        })
      }
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (id: string): Promise<void> => {
    setError(null)
    try {
      await remove(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const handleRestore = async (): Promise<void> => {
    setError(null)
    try {
      await restoreBuiltins()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className={css.section}>
      <div className={css.toolbar}>
        <button type="button" className={css.primary} onClick={openNew}>{t('list.add')}</button>
        <button type="button" className={css.secondary} onClick={() => { void handleRestore() }}>{t('list.restore')}</button>
      </div>
      {error !== null && editing === null && <p className={css.error}>{t('list.error')}: {error}</p>}
      {state.profiles.length === 0
        ? <p className={css.empty}>{t('list.empty')}</p>
        : (
          <div className={css.list}>
            {state.profiles.map(profile => (
              <div key={profile.id} className={css.card}>
                <div className={css.cardHeader}>
                  <strong>{profile.name}</strong>
                  <span className={profile.builtin ? css.builtin : css.custom}>
                    {profile.builtin ? t('list.builtin') : t('list.custom')}
                  </span>
                  <span className={profile.enabled ? css.enabled : css.disabled}>
                    {profile.enabled ? t('list.enabled') : t('list.disabled')}
                  </span>
                </div>
                <div className={css.cardBody}>
                  <span>{profile.id}</span>
                  <span>{profile.modelProvider} / {profile.model}</span>
                  <span>{profile.reasoningEffort ?? t('form.reasoningEffort.none')}</span>
                </div>
                <div className={css.cardActions}>
                  <button type="button" onClick={() => openEdit(profile)}>{t('list.edit')}</button>
                  {!profile.builtin && (
                    <button type="button" onClick={() => { void handleRemove(profile.id) }}>{t('list.delete')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      {editing !== null && draft !== null && (
        <div className={css.form}>
          <h3>{editing.mode === 'new' ? t('form.newTitle') : t('form.title')}</h3>
          {error !== null && <p className={css.error}>{t('form.error')}: {error}</p>}
          <label className={css.field}>
            <span>{t('form.id')}</span>
            <input
              value={draft.id}
              disabled={editing.mode === 'edit'}
              onChange={event => setDraft(current => current === null ? null : { ...current, id: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span>{t('form.name')}</span>
            <input value={draft.name ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, name: event.target.value })} />
          </label>
          <label className={css.field}>
            <span>{t('form.description')}</span>
            <textarea value={draft.description ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, description: event.target.value })} />
          </label>
          <label className={css.field}>
            <span>{t('form.enabled')}</span>
            <input type="checkbox" checked={draft.enabled ?? true} onChange={event => setDraft(current => current === null ? null : { ...current, enabled: event.target.checked })} />
          </label>
          <label className={css.field}>
            <span>{t('form.provider')}</span>
            <select value={draft.provider ?? 'spawn'} onChange={event => setDraft(current => current === null ? null : { ...current, provider: event.target.value as 'spawn' | 'fork' })}>
              <option value="spawn">spawn</option>
              <option value="fork">fork</option>
            </select>
          </label>
          <label className={css.field}>
            <span>{t('form.modelProvider')}</span>
            <input value={draft.modelProvider ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, modelProvider: event.target.value })} />
          </label>
          <label className={css.field}>
            <span>{t('form.model')}</span>
            <input value={draft.model ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, model: event.target.value })} />
          </label>
          <label className={css.field}>
            <span>{t('form.reasoningEffort')}</span>
            <select value={draft.reasoningEffort ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, reasoningEffort: event.target.value === '' ? undefined : event.target.value as SubagentProfilePayload['reasoningEffort'] })}>
              <option value="">{t('form.reasoningEffort.none')}</option>
              <option value="off">off</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="max">max</option>
            </select>
          </label>
          <label className={css.field}>
            <span>{t('form.maxTokens')}</span>
            <input type="number" value={draft.maxTokens ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, maxTokens: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </label>
          <label className={css.field}>
            <span>{t('form.maxDepth')}</span>
            <input type="number" value={draft.maxDepth ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, maxDepth: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </label>
          <label className={css.field}>
            <span>{t('form.persona')}</span>
            <textarea value={draft.persona ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, persona: event.target.value })} />
          </label>
          <label className={css.field}>
            <span>{t('form.promptTemplate')}</span>
            <textarea value={draft.promptTemplate ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, promptTemplate: event.target.value })} />
          </label>
          <label className={css.field}>
            <span>{t('form.toolFilterAllow')}</span>
            <input value={draft.toolFilter?.allow?.join(', ') ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, allow: parseCommaList(event.target.value) } })} />
          </label>
          <label className={css.field}>
            <span>{t('form.toolFilterDeny')}</span>
            <input value={draft.toolFilter?.deny?.join(', ') ?? ''} onChange={event => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, deny: parseCommaList(event.target.value) } })} />
          </label>
          <label className={css.field}>
            <span>{t('form.backgroundMode')}</span>
            <select value={draft.backgroundMode ?? 'one-shot'} onChange={event => setDraft(current => current === null ? null : { ...current, backgroundMode: event.target.value as 'one-shot' | 'continuable' })}>
              <option value="one-shot">one-shot</option>
              <option value="continuable">continuable</option>
            </select>
          </label>
          <div className={css.actions}>
            <button type="button" disabled={saving} onClick={() => { void save() }}>{saving ? '...' : t('form.save')}</button>
            <button type="button" disabled={saving} onClick={close}>{t('form.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export { NS }
