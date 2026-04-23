import { expect, it } from 'vitest'
import customModule from './custom.js'

const { custom } = customModule

it('uses a custom snapshot directory', () => {
  expect(custom()).toMatchSnapshot()
})
