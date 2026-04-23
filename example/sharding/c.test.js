import { expect, it } from 'vitest'
import sharedModule from './shared.js'

const { meaning } = sharedModule

it('shard file c', () => {
  expect(meaning()).toBe(42)
})
