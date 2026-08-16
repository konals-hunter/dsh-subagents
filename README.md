# @konals/dsh-subagents

DSH subagent profile manager: a Settings "Subagents" page for builtin/custom
subagent definitions plus a `subagent_profile` model tool that spawns children
through the native `ctx.subagents` providers.

![dsh-subagents settings screenshot](screenshots/ScreenShot_2026-08-16_130641_672.png)

## Features

- Builtin profiles: Explore, General, Vision.
- Add, edit, and delete custom profiles; builtin profiles are editable but not deletable.
- Per-profile model, thinking variant (`reasoningEffort`), persona, prompt template, tool filter, max tokens, max depth, and background mode.
- One `subagent_profile` tool with an optional `profile` parameter; omitting the profile behaves like the plain `subagent` tool.
- Optional `imagePath` parameter: when set, the subagent is instructed to call `read_image` first so multimodal models (e.g. Vision) can see the image.
- Spawned children use the same `spawn`/`fork` providers as the official tool, so they appear in the normal subagent UI.
- Per-model Thinking Variant configuration (available efforts + default); shared by Subagents and the composer model picker.
- On first launch, `stepfun / step-3.7-flash` is seeded with `low/medium/high` (default `medium`).

## Tip: Configure a vision-capable model in DSH

If `read_image` fails with `model "<id>" does not declare image input`, the model
is not declared as image-capable in DSH. Make sure the model entry in
`~/.dsh/settings.yaml` (or Settings > Models) declares `input: [text, image]`:

```yaml
llm-pi-ai:
  providers:
    your-provider:
      models:
        - id: your-vision-model
          input: [text, image]
```

Then restart `dsh web`. This only works if the provider/model actually accepts
image input.

## Install

### Local development (from a checkout)

`<repo-path>` is the **local filesystem path** to this plugin directory, not a GitHub URL.

```bash
dsh plugin --profile web add link:D:/path/to/dsh-subagents
# restart dsh web
```

### From the npm registry (after publishing)

```bash
dsh plugin --profile web add @konals/dsh-subagents
# restart dsh web
```

## Storage

Profiles are stored in `~/.dsh/dsh-subagents.json` (atomic write, mode 0600).

## Settings

Open Settings > Subagents. Use the list to edit builtin/custom profiles, add
custom profiles, delete custom profiles, or restore missing builtins.

## Relationship to the official subagent tool

The official `subagent` tool remains installed. `subagent_profile` is a second
consumer of the same `ctx.subagents` spawn/fork providers; both create ordinary
subagent sessions in the UI tree.

## Security

All `/api/dsh-subagents/*` routes are loopback-only. The JSON file is local and
user-owned; no secrets are stored.
