/**
 * Standalone build config for dsh-subagents: node-half lib/ (ESM) plus the
 * browser bundle lib/client.js for the GUI's window.__ModuleLoader__.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const REPOSITORY_ROOT = fileURLToPath(new URL('.', import.meta.url))

const cssModulesPlugin = {
  name: 'dsh-css-modules-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
    return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      classMap[local] = exp.name
    }
    return [
      'const css = ' + JSON.stringify(code.toString()) + ';',
      'const tagId = ' + JSON.stringify('dsh-subagents/' + basename(fileId)) + ';',
      "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
      "  const tag = document.createElement('style');",
      "  tag.dataset.plugin = 'dsh-subagents';",
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
      'export default ' + JSON.stringify(classMap) + ';',
    ].join('\n')
  },
}

function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = sep + 'lib' + sep + 'types' + sep
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

const lib: UserConfig = {
  name: 'dsh-subagents',
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-jobs',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-tools',
  ],
}

const client: UserConfig = {
  name: 'dsh-subagents/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (PLATFORM_MODULES.includes(id as never) ? undefined : true),
  plugins: [cssModulesPlugin],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: "window.__ModuleLoader__.load({ id: '@konals/dsh-subagents', factory: (require) => {",
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default ({ env }: { env?: { DSH_BUILD_FACE?: string } }) => {
  const face = env?.DSH_BUILD_FACE
  if (face === 'client') return [client]
  if (face === 'host') return [lib]
  return [lib, client]
}
