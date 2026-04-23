import { describe, expect, it } from 'vitest'
import { greet } from './greeter.js'

describe('typescript config', () => {
  it('loads a ts config file', () => {
    expect(greet('vitest')).toBe('hello vitest')
  })
})
