import { describe, expect, it } from 'vitest'
import renderModule from './render.js'

const { renderGreeting } = renderModule

describe('snapshots', () => {
  it('renders a heading', () => {
    expect(renderGreeting('Bazel')).toMatchSnapshot()
  })
})
