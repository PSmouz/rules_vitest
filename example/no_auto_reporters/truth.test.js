import { expect, it } from 'vitest'
import truthModule from './truth.js'

const { truth } = truthModule

it('works without Bazel-managed reporters', () => {
  expect(truth()).toBe(true)
})
