import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

async function request(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = text }
  return { status: response.status, json }
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

  it('rejects invalid payloads with 400', async () => {
    const bad = await request('/api/dsh-subagents/profiles', 'POST', { id: 'x', name: '' })
    expect(bad.status).toBe(400)
  })
})
