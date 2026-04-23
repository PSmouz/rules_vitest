import { describe, expect, it } from 'vitest'
import mathModule from './math.js'

const { multiply } = mathModule

describe('custom reporters', () => {
  it('runs tests with an appended custom reporter', () => {
    expect(multiply(3, 4)).toBe(12)
  })
})
