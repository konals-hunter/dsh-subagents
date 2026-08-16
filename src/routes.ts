/**
 * The /api/dsh-subagents route family: profile list/create/update/delete and
 * builtin restore. Every route carries a loopback-only trust fence.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SubagentStore } from './store.ts'
import { StoreClientError, validateProfilePatch, validateProfilePayload } from './store.ts'
import { SUBAGENTS_API } from './protocol.ts'

const MAX_JSON_BODY_BYTES = 64 * 1024
const BODY_TOO_LARGE = Symbol('body-too-large')

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined | typeof BODY_TOO_LARGE> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = chunk as Buffer
      size += buffer.length
      if (size > MAX_JSON_BODY_BYTES) {
        req.resume?.()
        return BODY_TOO_LARGE
      }
      chunks.push(buffer)
    }
  } catch {
    req.resume?.()
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (Array.isArray(parsed)) return undefined
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Minimal llm seam used by the model-info diagnostic route. */
export interface LlmDiagnosticFace {
  resolveModelInfo(provider: string, model: string): Promise<{ inputModalities?: readonly string[] }>
}

/** Build every /api/dsh-subagents route. */
export function makeRoutes(deps: {
  store: SubagentStore
  tools: { schemas(): { name: string }[] }
  llm?: LlmDiagnosticFace
}): { routes: WebRoute[] } {
  const { store, tools, llm } = deps

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: SUBAGENTS_API.profiles,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
        const method = req.method ?? 'GET'
        if (method === 'GET') {
          try {
            writeJson(res, 200, { profiles: store.list(), corrupt: store.isCorrupt() })
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(req)
          if (body === BODY_TOO_LARGE) { writeJson(res, 413, { error: 'request body too large' }); return }
          if (body === undefined) { writeJson(res, 400, { error: 'invalid JSON body' }); return }
          try {
            const profile = store.create(validateProfilePayload(body))
            writeJson(res, 201, { profile })
          } catch (error) {
            writeJson(res, error instanceof StoreClientError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method !== 'PUT' && method !== 'DELETE') { writeJson(res, 405, { error: 'method not allowed: ' + method }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = queryParam(url, 'id')
        if (id === undefined || id === '') { writeJson(res, 400, { error: 'id query parameter is required' }); return }
        try {
          if (method === 'PUT') {
            const body = await readJsonBody(req)
            if (body === BODY_TOO_LARGE) { writeJson(res, 413, { error: 'request body too large' }); return }
            if (body === undefined) { writeJson(res, 400, { error: 'invalid JSON body' }); return }
            const profile = store.update(id, validateProfilePatch(body))
            writeJson(res, 200, { profile })
          } else {
            store.delete(id)
            writeJson(res, 200, { ok: true })
          }
        } catch (error) {
          writeJson(res, error instanceof StoreClientError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SUBAGENTS_API.restoreBuiltins,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') }); return }
        try {
          const profiles = store.restoreBuiltins()
          const corrupt = store.isCorrupt()
          writeJson(res, 200, corrupt
            ? { profiles, corrupt: true, error: 'store file is corrupt; manual recovery required' }
            : { profiles, corrupt: false })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SUBAGENTS_API.tools,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
        if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') }); return }
        try {
          writeJson(res, 200, { tools: tools.schemas().map(schema => schema.name) })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SUBAGENTS_API.modelInfo,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
        if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const provider = queryParam(url, 'provider')
        const model = queryParam(url, 'model')
        if (provider === undefined || provider === '' || model === undefined || model === '') {
          writeJson(res, 400, { error: 'provider and model query parameters are required' })
          return
        }
        if (llm === undefined) {
          writeJson(res, 503, { error: 'llm service unavailable' })
          return
        }
        try {
          const info = await llm.resolveModelInfo(provider, model)
          writeJson(res, 200, { provider, model, inputModalities: info.inputModalities ?? [] })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]

  return { routes }
}
