import { expect, it } from 'vitest'
import alphaModule from './alpha.js'

const { alpha } = alphaModule

it('stores alpha snapshots', () => {
  expect(alpha()).toMatchSnapshot()
})
