import { expect, it } from 'vitest'
import sharedModule from './shared.js'

const { meaning } = sharedModule

it('shard file b', () => {
  expect(meaning()).toBe(42)
})
