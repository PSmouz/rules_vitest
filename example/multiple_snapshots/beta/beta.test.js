import { expect, it } from 'vitest'
import betaModule from './beta.js'

const { beta } = betaModule

it('stores beta snapshots', () => {
  expect(beta()).toMatchSnapshot()
})
