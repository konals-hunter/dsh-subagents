import { describe, expect, it } from 'vitest'
import { SubagentStore } from '../src/index.ts'
import { makeRoutes } from '../src/index.ts'
import { makeSubagentProfileTool } from '../src/index.ts'
import { installEffortInjection } from '../src/index.ts'

describe('host wiring', () => {
  it('exposes the expected constructors', () => {
    expect(typeof SubagentStore).toBe('function')
    expect(typeof makeRoutes).toBe('function')
    expect(typeof makeSubagentProfileTool).toBe('function')
    expect(typeof installEffortInjection).toBe('function')
  })
})
