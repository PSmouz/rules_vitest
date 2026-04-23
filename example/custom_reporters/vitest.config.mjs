import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const customReporterPath = fileURLToPath(new URL('./custom_reporter.cjs', import.meta.url))

export default defineConfig({
  test: {
    reporters: [customReporterPath],
  },
})
