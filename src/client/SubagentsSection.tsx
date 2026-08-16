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
import type { ModelThinkingConfig, ModelThinkingConfigPatch, ModelThinkingVariant, SubagentProfile, SubagentProfilePatch, SubagentProfilePayload, ToolFilter } from '../protocol.ts'
import { getEffectiveDefaultEffort, getEffectiveReasoning } from '../thinking.ts'
import type { SubagentsSectionState } from './controller.ts'
import type { ModelCatalogState } from './ModelCatalogController.ts'
import type { PresetCatalogState } from './PresetCatalogController.ts'
import type { ToolCatalogState } from './ToolCatalogController.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { EffortSelect, type EffortOption } from './EffortSelect.tsx'
import { MenuSelect } from './MenuSelect.tsx'
import { Switch } from './Switch.tsx'
import { ToolMultiSelect } from './ToolMultiSelect.tsx'
import { NS } from './locales.ts'
import css from './subagents.module.css'

/** Registration-side business face for the settings section. */
export interface SubagentsSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useSubagents. */
    subagents: SnapshotStore<SubagentsSectionState>
    /** Host model catalog snapshot bound by the renderer as useModelCatalog. */
    modelCatalog: SnapshotStore<ModelCatalogState>
    /** Host preset catalog snapshot bound by the renderer as usePresetCatalog. */
    presetCatalog: SnapshotStore<PresetCatalogState>
    /** Host tool catalog snapshot bound by the renderer as useToolCatalog. */
    toolCatalog: SnapshotStore<ToolCatalogState>
  }
  load: () => Promise<void>
  loadModels: () => Promise<void>
  loadPresets: () => Promise<void>
  loadTools: () => Promise<void>
  create: (payload: SubagentProfilePayload) => Promise<void>
  update: (id: string, patch: SubagentProfilePatch) => Promise<void>
  remove: (id: string) => Promise<void>
  restoreBuiltins: () => Promise<void>
  createThinkingConfig: (payload: ModelThinkingConfig) => Promise<void>
  updateThinkingConfig: (provider: string, model: string, patch: ModelThinkingConfigPatch) => Promise<void>
  deleteThinkingConfig: (provider: string, model: string) => Promise<void>
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
    preset: 'inherit',
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
    preset: profile.preset ?? 'inherit',
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

function parseVariantsText(text: string): ModelThinkingVariant[] {
  return text.split('\n').map(line => line.trim()).filter(line => line !== '').map(line => {
    const [rawId, ...rest] = line.split('=')
    const id = (rawId ?? '').trim()
    const nameAndDescription = rest.join('=').trim()
    const [rawName, ...descriptionParts] = nameAndDescription.split('|')
    const name = (rawName ?? '').trim()
    const description = descriptionParts.join('|').trim()
    const variant: ModelThinkingVariant = { id, name }
    if (description !== '') variant.description = description
    return variant
  })
}

function effortOptionsFor(
  provider: string,
  model: string,
  groups: ModelCatalogState['groups'],
  configs: readonly ModelThinkingConfig[],
  t: (key: Parameters<SubagentsSectionProps['t']>[0]) => string,
): EffortOption[] {
  const reasoning = getEffectiveReasoning(provider, model, configs, groups)
  const options: EffortOption[] = [{ value: null, label: t('form.reasoningEffort.none') }]
  if (reasoning !== undefined) {
    for (const effort of reasoning.efforts) {
      options.push({ value: effort.id, label: effort.name })
    }
  }
  return options
}

interface ThinkingConfigDraft {
  provider: string
  model: string
  variantsText: string
  defaultVariant: string
}

function blankThinkingConfigDraft(): ThinkingConfigDraft {
  return { provider: '', model: '', variantsText: 'low=low\nmedium=medium\nhigh=high', defaultVariant: 'medium' }
}

/**
 * Render the Subagents settings section.
 * @param props - composed slot props.
 * @returns the section.
 */
export function SubagentsSection(props: SubagentsSectionProps): ReactNode {
  const { useSubagents, useModelCatalog, usePresetCatalog, useToolCatalog, t, load, loadModels, loadPresets, loadTools, create, update, remove, restoreBuiltins, createThinkingConfig, updateThinkingConfig, deleteThinkingConfig } = props
  const state = useSubagents(snapshot => snapshot)
  const catalog = useModelCatalog(snapshot => snapshot)
  const presetCatalog = usePresetCatalog(snapshot => snapshot)
  const toolCatalog = useToolCatalog(snapshot => snapshot)
  const [editing, setEditing] = useState<{ mode: 'new' } | { mode: 'edit'; profile: SubagentProfile } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configEditor, setConfigEditor] = useState<{ mode: 'new' } | { mode: 'edit'; config: ModelThinkingConfig } | null>(null)
  const [configDraft, setConfigDraft] = useState<ThinkingConfigDraft | null>(null)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadModels() }, [loadModels])
  useEffect(() => { void loadPresets() }, [loadPresets])
  useEffect(() => { void loadTools() }, [loadTools])

  const providerOptions = useMemo(() => [
    { value: 'spawn', label: 'spawn' },
    { value: 'fork', label: 'fork' },
  ], [])
  const backgroundOptions = useMemo(() => [
    { value: 'one-shot', label: 'one-shot' },
    { value: 'continuable', label: 'continuable' },
  ], [])
  const presetOptions = useMemo(() => {
    const items: Array<{ value: string; label: string }> = [
      { value: 'default', label: t('form.preset.default') },
      { value: 'inherit', label: t('form.preset.inherit') },
    ]
    for (const preset of presetCatalog.presets) {
      items.push({ value: preset.id, label: preset.name ?? preset.id })
    }
    return items
  }, [presetCatalog.presets, t])

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
          preset: draft.preset,
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

  const openNewConfig = (): void => {
    setConfigEditor({ mode: 'new' })
    setConfigDraft(blankThinkingConfigDraft())
    setConfigError(null)
  }
  const openEditConfig = (config: ModelThinkingConfig): void => {
    setConfigEditor({ mode: 'edit', config })
    setConfigDraft({
      provider: config.provider,
      model: config.model,
      variantsText: config.variants.map(variant => variant.description === undefined ? `${variant.id}=${variant.name}` : `${variant.id}=${variant.name}|${variant.description}`).join('\n'),
      defaultVariant: config.defaultVariant ?? '',
    })
    setConfigError(null)
  }
  const closeConfig = (): void => {
    setConfigEditor(null)
    setConfigDraft(null)
    setConfigError(null)
  }
  const saveConfig = async (): Promise<void> => {
    if (configDraft === null) return
    const variants = parseVariantsText(configDraft.variantsText)
    if (variants.length === 0) { setConfigError('至少需要一行 variant'); return }
    const defaultVariant = configDraft.defaultVariant.trim() === '' ? undefined : configDraft.defaultVariant.trim()
    setConfigSaving(true)
    setConfigError(null)
    try {
      if (configEditor?.mode === 'new') {
        await createThinkingConfig({ provider: configDraft.provider, model: configDraft.model, variants, ...(defaultVariant === undefined ? {} : { defaultVariant }) })
      } else if (configEditor?.mode === 'edit') {
        const patch: ModelThinkingConfigPatch = { variants, ...(defaultVariant === undefined ? { defaultVariant: null } : { defaultVariant }) }
        await updateThinkingConfig(configEditor.config.provider, configEditor.config.model, patch)
      }
      closeConfig()
    } catch (cause) {
      setConfigError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setConfigSaving(false)
    }
  }
  const handleDeleteConfig = async (config: ModelThinkingConfig): Promise<void> => {
    setConfigError(null)
    try {
      await deleteThinkingConfig(config.provider, config.model)
    } catch (cause) {
      setConfigError(cause instanceof Error ? cause.message : String(cause))
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
                  <div className={css.rowActions}>
                    <Switch
                      checked={profile.enabled}
                      ariaLabel={`${t('list.enabled')} ${profile.name}`}
                      onChange={enabled => { void handleQuickUpdate(profile.id, { enabled }) }}
                    />
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
                <div className={css.cardPresetRow}>
                  <MenuSelect
                    value={profile.preset ?? 'inherit'}
                    options={presetOptions}
                    size="sm"
                    ariaLabel={`${t('form.preset')} ${profile.name}`}
                    onChange={preset => { void handleQuickUpdate(profile.id, { preset }) }}
                  />
                </div>
                <div className={css.cardControlsRow}>
                  <ModelSelect
                    modelProvider={profile.modelProvider}
                    model={profile.model}
                    groups={catalog.groups}
                    status={catalog.status}
                    ariaLabel={`${t('form.model')} ${profile.name}`}
                    loadingLabel={t('form.model.loading')}
                    emptyLabel={t('form.model.empty')}
                    onSelect={(modelProvider, model) => {
                      const reasoning = getEffectiveReasoning(modelProvider, model, state.thinkingConfigs, catalog.groups)
                      void handleQuickUpdate(profile.id, {
                        modelProvider,
                        model,
                        reasoningEffort: getEffectiveDefaultEffort(reasoning) ?? null,
                      })
                    }}
                  />
                  <EffortSelect
                    value={profile.reasoningEffort}
                    options={effortOptionsFor(profile.modelProvider, profile.model, catalog.groups, state.thinkingConfigs, t)}
                    ariaLabel={`${t('form.reasoningEffort')} ${profile.name}`}
                    onChange={reasoningEffort => { void handleQuickUpdate(profile.id, { reasoningEffort }) }}
                  />
                </div>
                {profile.description !== '' && (
                  <p className={css.cardDescription}>{profile.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      <div className={css.sectionBlock}>
        <div className={css.toolbar}>
          <h3 className={css.sectionTitle}>{t('config.title')}</h3>
          <Button variant="outline" size="md" onClick={openNewConfig}>{t('config.add')}</Button>
        </div>
        {configError !== null && <p className={css.error}>{configError}</p>}
        {state.thinkingConfigs.length === 0
          ? <p className={css.empty}>{t('config.empty')}</p>
          : (
            <div className={css.list}>
              {state.thinkingConfigs.map(config => (
                <div key={config.provider + '/' + config.model} className={css.card}>
                  <div className={css.cardHeader}>
                    <div className={css.cardIdentity}>
                      <strong className={css.cardName}>{config.provider} / {config.model}</strong>
                      <span className={css.cardId}>{config.variants.map(v => v.name).join(', ')}</span>
                    </div>
                    <div className={css.rowActions}>
                      <Button variant="ghost" size="sm" onClick={() => openEditConfig(config)}>{t('config.edit')}</Button>
                      <Button variant="ghost" size="sm" className={css.dangerButton} onClick={() => { void handleDeleteConfig(config) }}>{t('config.delete')}</Button>
                    </div>
                  </div>
                  <p className={css.cardDescription}>
                    {t('config.defaultVariant')}: {config.defaultVariant ?? t('form.reasoningEffort.none')}
                  </p>
                </div>
              ))}
            </div>
          )}
        {configEditor !== null && configDraft !== null && (
          <div className={css.editor}>
            <h3 className={css.editorTitle}>{configEditor.mode === 'new' ? t('config.add') : t('config.edit')}</h3>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('form.model')}</span>
              <ModelSelect
                modelProvider={configDraft.provider}
                model={configDraft.model}
                groups={catalog.groups}
                status={catalog.status}
                disabled={configEditor.mode === 'edit'}
                size="md"
                ariaLabel={t('form.model')}
                loadingLabel={t('form.model.loading')}
                emptyLabel={t('form.model.empty')}
                onSelect={(modelProvider, model) => setConfigDraft(current => current === null ? null : { ...current, provider: modelProvider, model })}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('config.variants')}</span>
              <textarea
                className={css.input}
                value={configDraft.variantsText}
                placeholder={t('config.variantsPlaceholder')}
                onChange={event => setConfigDraft(current => current === null ? null : { ...current, variantsText: event.target.value })}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('config.defaultVariant')}</span>
              <Input
                value={configDraft.defaultVariant}
                className={css.inputWrap}
                onChange={event => setConfigDraft(current => current === null ? null : { ...current, defaultVariant: event.target.value })}
              />
            </label>
            <div className={css.editorActions}>
              <Button variant="primary" size="md" disabled={configSaving} onClick={() => { void saveConfig() }}>{configSaving ? '...' : t('config.save')}</Button>
              <Button variant="outline" size="md" disabled={configSaving} onClick={closeConfig}>{t('config.cancel')}</Button>
            </div>
          </div>
        )}
      </div>
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
              onSelect={(modelProvider, model) => {
                const reasoning = getEffectiveReasoning(modelProvider, model, state.thinkingConfigs, catalog.groups)
                setDraft(current => current === null ? null : {
                  ...current,
                  modelProvider,
                  model,
                  reasoningEffort: getEffectiveDefaultEffort(reasoning) ?? null,
                })
              }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.reasoningEffort')}</span>
            <EffortSelect
              value={draft.reasoningEffort ?? null}
              options={effortOptionsFor(draft.modelProvider ?? '', draft.model ?? '', catalog.groups, state.thinkingConfigs, t)}
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
            <ToolMultiSelect
              value={draft.toolFilter?.allow ?? []}
              tools={toolCatalog.tools}
              size="md"
              ariaLabel={t('form.toolFilterAllow')}
              onChange={allow => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, allow: allow.length > 0 ? allow : undefined } })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.toolFilterDeny')}</span>
            <ToolMultiSelect
              value={draft.toolFilter?.deny ?? []}
              tools={toolCatalog.tools}
              size="md"
              ariaLabel={t('form.toolFilterDeny')}
              onChange={deny => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, deny: deny.length > 0 ? deny : undefined } })}
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
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('form.preset')}</span>
            <MenuSelect
              value={draft.preset ?? 'inherit'}
              options={presetOptions}
              size="md"
              ariaLabel={t('form.preset')}
              onChange={preset => setDraft(current => current === null ? null : { ...current, preset })}
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
