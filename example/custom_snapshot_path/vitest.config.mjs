import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    resolveSnapshotPath(testPath, snapExtension) {
      return path.join(path.dirname(testPath), '__snaps__', `${path.basename(testPath)}${snapExtension}`)
    },
  },
})
