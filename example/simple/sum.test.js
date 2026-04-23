import { describe, expect, it } from 'vitest'
import sumModule from './sum.js'

const { sum } = sumModule

describe('sum', () => {
  it('adds numbers', () => {
    expect(sum(2, 3)).toBe(5)
  })
})
