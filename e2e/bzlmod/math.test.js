import { expect, it } from 'vitest'
import mathModule from './math.js'

const { square } = mathModule

it('works from a consumer workspace', () => {
  expect(square(6)).toBe(36)
})
