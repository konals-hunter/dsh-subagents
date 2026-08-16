/**
 * Settings section for Subagents: list, inline quick actions, add/edit form,
 * delete custom, and restore builtins.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings-surface SlotMap merge (settings.section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubagentProfile, SubagentProfilePatch, SubagentProfilePayload, ToolFilter } from '../protocol.ts'
import type { SubagentsSectionState } from './controller.ts'
import type { ModelCatalogState } from './ModelCatalogController.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { EffortSelect, type EffortOption } from './EffortSelect.tsx'
import { MenuSelect } from './MenuSelect.tsx'
import { Switch } from './Switch.tsx'
import { NS } from './locales.ts'
import css from './subagents.module.css'

/** Registration-side business face for the settings section. */
export interface SubagentsSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useSubagents. */
    subagents: SnapshotStore<SubagentsSectionState>
    /** Host model catalog snapshot bound by the renderer as useModelCatalog. */
    modelCatalog: SnapshotStore<ModelCatalogState>
  }
  load: () => Promise<void>
  loadModels: () => Promise<void>
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

/** Pick the lowest free custom-<n> id not already used by current profiles. */
export function nextCustomProfileId(profiles: SubagentProfile[]): string {
  const ids = new Set(profiles.map(profile => profile.id))
  let n = 1
  while (ids.has('custom-' + n)) n++
  return 'custom-' + n
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
  const { useSubagents, useModelCatalog, t, load, loadModels, create, update, remove, restoreBuiltins } = props
  const state = useSubagents(snapshot => snapshot)
  const catalog = useModelCatalog(snapshot => snapshot)
  const [editing, setEditing] = useState<{ mode: 'new' } | { mode: 'edit'; profile: SubagentProfile } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadModels() }, [loadModels])

  const effortOptions = useMemo<EffortOption[]>(() => [
    { value: null, label: t('form.reasoningEffort.none') },
    { value: 'off', label: 'off' },
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'max', label: 'max' },
  ], [t])
  const providerOptions = useMemo(() => [
    { value: 'spawn', label: 'spawn' },
    { value: 'fork', label: 'fork' },
  ], [])
  const backgroundOptions = useMemo(() => [
    { value: 'one-shot', label: 'one-shot' },
    { value: 'continuable', label: 'continuable' },
  ], [])

  if (state.status === 'error') {
    return <div className={css.section}><p className={css.error}>{t('error.load')} {state.error}</p></div>
  }
  if (state.status === 'loading') return <div className={css.section}>{t('nav')}...</div>

  const openNew = (): void => {
    setEditing({ mode: 'new' })
    setDraft({ ...blankDraft(), id: nextCustomProfileId(state.profiles) })
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
  const handleQuickUpdate = async (id: string, patch: SubagentProfilePatch): Promise<void> => {
    setError(null)
    try {
      await update(id, patch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className={css.section}>
      {state.corrupt === true && <p className={css.error}>{state.error ?? t('corrupt.banner')}</p>}
      <div className={css.toolbar}>
        <Button variant="primary" size="md" onClick={openNew}>{t('list.add')}</Button>
        <Button variant="outline" size="md" onClick={() => { void handleRestore() }}>{t('list.restore')}</Button>
      </div>
      {error !== null && editing === null && <p className={css.error}>{t('list.error')}: {error}</p>}
      {state.profiles.length === 0
        ? <p className={css.empty}>{t('list.empty')}</p>
        : (
          <div className={css.list}>
            {state.profiles.map(profile => (
              <div key={profile.id} className={css.card}>
                <div className={css.cardHeader}>
                  <div className={css.cardIdentity}>
                    <strong className={css.cardName}>{profile.name}</strong>
                    <Pill className={profile.builtin ? css.badgeBuiltin : css.badgeCustom}>
                      {profile.builtin ? t('list.builtin') : t('list.custom')}
                    </Pill>
                    <span className={css.cardId}>{profile.id}</span>
                  </div>
                  <div className={css.quickActions}>
                    <Switch
                      checked={profile.enabled}
                      ariaLabel={`${t('list.enabled')} ${profile.name}`}
                      onChange={enabled => { void handleQuickUpdate(profile.id, { enabled }) }}
                    />
                    <ModelSelect
                      modelProvider={profile.modelProvider}
                      model={profile.model}
                      groups={catalog.groups}
                      status={catalog.status}
                      ariaLabel={`${t('form.model')} ${profile.name}`}
                      loadingLabel={t('form.model.loading')}
                      emptyLabel={t('form.model.empty')}
                      onSelect={(modelProvider, model) => { void handleQuickUpdate(profile.id, { modelProvider, model }) }}
                    />
                    <EffortSelect
                      value={profile.reasoningEffort}
                      options={effortOptions}
                      ariaLabel={`${t('form.reasoningEffort')} ${profile.name}`}
                      onChange={reasoningEffort => { void handleQuickUpdate(profile.id, { reasoningEffort }) }}
                    />
                    <div className={css.rowActions}>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(profile)}>{t('list.edit')}</Button>
                      {!profile.builtin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={css.dangerButton}
                          onClick={() => { void handleRemove(profile.id) }}
                        >
                          {t('list.delete')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                {profile.description !== '' && (
                  <p className={css.cardDescription}>{profile.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      {editing !== null && draft !== null && (
        <div className={css.editor}>
          <h3 className={css.editorTitle}>{editing.mode === 'new' ? t('form.newTitle') : t('form.title')}</h3>
          {error !== null && <p className={css.error}>{t('form.error')}: {error}</p>}
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.id')}</span>
            <Input
              value={draft.id}
              disabled={editing.mode === 'edit'}
              className={css.inputWrap}
              onChange={event => setDraft(current => current === null ? null : { ...current, id: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.name')}</span>
            <Input
              value={draft.name ?? ''}
              className={css.inputWrap}
              onChange={event => setDraft(current => current === null ? null : { ...current, name: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.description')}</span>
            <textarea
              className={css.input}
              value={draft.description ?? ''}
              onChange={event => setDraft(current => current === null ? null : { ...current, description: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.enabled')}</span>
            <Switch
              checked={draft.enabled ?? true}
              label={draft.enabled ?? true ? t('list.enabled') : t('list.disabled')}
              onChange={enabled => setDraft(current => current === null ? null : { ...current, enabled })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.provider')}</span>
            <MenuSelect
              value={draft.provider ?? 'spawn'}
              options={providerOptions}
              size="md"
              ariaLabel={t('form.provider')}
              onChange={provider => setDraft(current => current === null ? null : { ...current, provider: provider as 'spawn' | 'fork' })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.model')}</span>
            <ModelSelect
              modelProvider={draft.modelProvider ?? ''}
              model={draft.model ?? ''}
              groups={catalog.groups}
              status={catalog.status}
              size="md"
              ariaLabel={t('form.model')}
              loadingLabel={t('form.model.loading')}
              emptyLabel={t('form.model.empty')}
              onSelect={(modelProvider, model) => setDraft(current => current === null ? null : { ...current, modelProvider, model })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.reasoningEffort')}</span>
            <EffortSelect
              value={draft.reasoningEffort ?? null}
              options={effortOptions}
              size="md"
              onChange={reasoningEffort => setDraft(current => current === null ? null : { ...current, reasoningEffort })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.maxTokens')}</span>
            <Input
              type="number"
              value={draft.maxTokens ?? ''}
              className={css.inputWrap}
              onChange={event => setDraft(current => current === null ? null : { ...current, maxTokens: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.maxDepth')}</span>
            <Input
              type="number"
              value={draft.maxDepth ?? ''}
              className={css.inputWrap}
              onChange={event => setDraft(current => current === null ? null : { ...current, maxDepth: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.persona')}</span>
            <textarea
              className={css.input}
              value={draft.persona ?? ''}
              onChange={event => setDraft(current => current === null ? null : { ...current, persona: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.promptTemplate')}</span>
            <textarea
              className={css.input}
              value={draft.promptTemplate ?? ''}
              onChange={event => setDraft(current => current === null ? null : { ...current, promptTemplate: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.toolFilterAllow')}</span>
            <Input
              value={draft.toolFilter?.allow?.join(', ') ?? ''}
              className={css.inputWrap}
              onChange={event => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, allow: parseCommaList(event.target.value) } })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.toolFilterDeny')}</span>
            <Input
              value={draft.toolFilter?.deny?.join(', ') ?? ''}
              className={css.inputWrap}
              onChange={event => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, deny: parseCommaList(event.target.value) } })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.backgroundMode')}</span>
            <MenuSelect
              value={draft.backgroundMode ?? 'one-shot'}
              options={backgroundOptions}
              size="md"
              ariaLabel={t('form.backgroundMode')}
              onChange={backgroundMode => setDraft(current => current === null ? null : { ...current, backgroundMode: backgroundMode as 'one-shot' | 'continuable' })}
            />
          </label>
          <div className={css.editorActions}>
            <Button variant="primary" size="md" disabled={saving} onClick={() => { void save() }}>{saving ? '...' : t('form.save')}</Button>
            <Button variant="outline" size="md" disabled={saving} onClick={close}>{t('form.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export { NS }
