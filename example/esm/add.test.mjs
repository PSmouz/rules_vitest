import { describe, expect, it } from 'vitest'
import { add } from './add.mjs'

describe('esm', () => {
  it('runs native esm tests', () => {
    expect(add(1, 4)).toBe(5)
  })
})
