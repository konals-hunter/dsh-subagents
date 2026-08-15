import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { SubagentStore } from '../src/store.ts'
import { makeRoutes } from '../src/routes.ts'

const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
const store = new SubagentStore(join(dir, 'store.json'))
const { routes } = makeRoutes({ store })

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = routes.find(r => r.kind === 'exact' && r.path === url.pathname)
    if (route === undefined) { res.writeHead(404); res.end('not found'); return }
    void route.handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  base = 'http://127.0.0.1:' + (typeof address === 'object' && address !== null ? address.port : 0)
})

afterAll(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

async function request(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = text }
  return { status: response.status, json }
}

async function rawRequest(path: string, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) as unknown }) })
    })
    req.on('error', reject)
    req.end()
  })
}

async function callHandler(
  route: { handler: (req: never, res: never) => void | Promise<void> },
  method = 'GET',
  url = '/api/dsh-subagents/profiles',
): Promise<{ status: number; json: unknown }> {
  let status = 0
  let body = ''
  const res = {
    writeHead(code: number) {
      status = code
      return res
    },
    end(data?: unknown) {
      body = String(data ?? '')
      return res
    },
  }
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  await route.handler(req as never, res as never)
  return { status, json: JSON.parse(body) as unknown }
}

describe('subagents routes', () => {
  it('lists builtins and CRUDs a custom profile', async () => {
    const listed = await request('/api/dsh-subagents/profiles')
    expect(listed.status).toBe(200)
    expect((listed.json as { profiles: Array<{ id: string }> }).profiles.map(p => p.id)).toEqual(['explore', 'general', 'vision'])

    const created = await request('/api/dsh-subagents/profiles', 'POST', {
      id: 'route-custom',
      name: 'Route Custom',
      description: 'Created through REST',
      enabled: true,
      provider: 'spawn',
      modelProvider: 'jiyuan',
      model: 'deepseek-v4-flash-0731',
    })
    expect(created.status).toBe(201)
    const id = (created.json as { profile: { id: string } }).profile.id

    const updated = await request('/api/dsh-subagents/profiles?id=' + id, 'PUT', { model: 'deepseek-v4-pro' })
    expect((updated.json as { profile: { model: string } }).profile.model).toBe('deepseek-v4-pro')

    const deleted = await request('/api/dsh-subagents/profiles?id=' + id, 'DELETE')
    expect(deleted.status).toBe(200)
  })

  it('rejects builtin deletion', async () => {
    const deleted = await request('/api/dsh-subagents/profiles?id=explore', 'DELETE')
    expect(deleted.status).toBe(400)
    expect((deleted.json as { error: string }).error).toMatch(/builtin|内置/)
  })

  it('restores missing builtins', async () => {
    const current = JSON.parse(readFileSync(store.path, 'utf8')) as { profiles: Array<{ id: string }> }
    writeFileSync(store.path, JSON.stringify({ version: 1, profiles: current.profiles.filter(p => p.id !== 'general') }, null, 2))
    const restored = await request('/api/dsh-subagents/profiles/restore-builtins', 'POST')
    expect(restored.status).toBe(200)
    expect((restored.json as { profiles: Array<{ id: string }> }).profiles.map(p => p.id)).toContain('general')
  })

  it('GET returns corrupt flag for a corrupt store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const malformed = JSON.stringify({
      version: 1,
      profiles: [{
        id: 'broken',
        name: 'Broken',
        description: 'x',
        enabled: true,
        builtin: false,
        provider: 'spawn',
        modelProvider: 'jiyuan',
        model: 'deepseek-v4-flash-0731',
        createdAt: 1,
        updatedAt: 1,
        persona: 123,
      }],
    })
    writeFileSync(path, malformed, 'utf8')
    const { routes } = makeRoutes({ store: new SubagentStore(path) })
    try {
      const response = await callHandler(routes[0], 'GET')
      const json = response.json as { profiles: Array<{ id: string }>; corrupt: boolean }
      expect(response.status).toBe(200)
      expect(json.corrupt).toBe(true)
      expect(json.profiles.map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
      expect(readFileSync(path, 'utf8')).toBe(malformed)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('restore returns corrupt flag and error for a corrupt store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-subagents-'))
    const path = join(dir, 'store.json')
    const malformed = JSON.stringify({
      version: 1,
      profiles: [{
        id: 'broken',
        name: 'Broken',
        description: 'x',
        enabled: true,
        builtin: false,
        provider: 'spawn',
        modelProvider: 'jiyuan',
        model: 'deepseek-v4-flash-0731',
        createdAt: 1,
        updatedAt: 1,
        toolFilter: { allow: 'read' },
      }],
    })
    writeFileSync(path, malformed, 'utf8')
    const { routes } = makeRoutes({ store: new SubagentStore(path) })
    try {
      const response = await callHandler(routes[1], 'POST', '/api/dsh-subagents/profiles/restore-builtins')
      const json = response.json as { profiles: Array<{ id: string }>; corrupt: boolean; error?: string }
      expect(response.status).toBe(200)
      expect(json.corrupt).toBe(true)
      expect(json.error).toContain('corrupt')
      expect(json.profiles.map(profile => profile.id)).toEqual(['explore', 'general', 'vision'])
      expect(readFileSync(path, 'utf8')).toBe(malformed)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects invalid payloads with 400', async () => {
    const bad = await request('/api/dsh-subagents/profiles', 'POST', { id: 'x', name: '' })
    expect(bad.status).toBe(400)
  })

  it('rejects JSON array bodies for PUT with 400', async () => {
    const response = await request('/api/dsh-subagents/profiles?id=explore', 'PUT', [])
    expect(response.status).toBe(400)
    expect((response.json as { error: string }).error).toMatch(/invalid JSON body|JSON object/)
  })

  it('returns 400 JSON when the request body stream is destroyed mid-read', async () => {
    let status = 0
    let body = ''
    const res = {
      writeHead(code: number) {
        status = code
        return res
      },
      end(data?: unknown) {
        body = String(data ?? '')
        return res
      },
    }
    const bodyStream = new Readable({
      read() {
        this.push(Buffer.from('{"name":'))
        this.destroy(new Error('stream destroyed'))
      },
    })
    const req = {
      method: 'PUT',
      url: '/api/dsh-subagents/profiles?id=explore',
      headers: { host: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
      [Symbol.asyncIterator]: bodyStream[Symbol.asyncIterator].bind(bodyStream),
    }
    await routes[0].handler(req as never, res as never)
    expect(status).toBe(400)
    expect(JSON.parse(body) as { error: string }).toMatchObject({ error: expect.stringContaining('invalid JSON body') })
  })

  it('rejects non-loopback Host headers with 403', async () => {
    const response = await rawRequest('/api/dsh-subagents/profiles', { host: 'example.com' })
    expect(response.status).toBe(403)
    expect((response.json as { error: string }).error).toMatch(/loopback/)
  })

  it('rejects cross-origin requests with 403', async () => {
    const response = await request('/api/dsh-subagents/profiles', 'GET', undefined, { origin: 'https://example.com' })
    expect(response.status).toBe(403)
    expect((response.json as { error: string }).error).toMatch(/loopback/)
  })

  it('returns JSON errors when the profile list store read fails', async () => {
    const { routes } = makeRoutes({ store: { list: () => { throw new Error('disk read failed') } } as never })
    const response = await callHandler(routes[0], 'GET')
    expect(response.status).toBe(500)
    expect((response.json as { error: string }).error).toContain('disk read failed')
  })

  it('returns JSON errors when restore fails', async () => {
    const { routes } = makeRoutes({ store: { restoreBuiltins: () => { throw new Error('restore failed') } } as never })
    const response = await callHandler(routes[1], 'POST', '/api/dsh-subagents/profiles/restore-builtins')
    expect(response.status).toBe(500)
    expect((response.json as { error: string }).error).toContain('restore failed')
  })
})
