import path from 'node:path'
import { pathToFileURL } from 'node:url'

function resolveRunfilesPath(rootpath) {
  return path.join(
    process.env.JS_BINARY__RUNFILES,
    process.env.JS_BINARY__WORKSPACE,
    rootpath,
  )
}

const helperUrl = pathToFileURL(
  resolveRunfilesPath('{{CONFIG_HELPER_SHORT_PATH}}'),
).href
const { createBazelVitestConfig } = await import(helperUrl)

export default await createBazelVitestConfig({
  userConfigShortPath: '{{USER_CONFIG_SHORT_PATH}}',
  autoConfigureReporters: {{AUTO_CONFIGURE_REPORTERS}},
  autoConfigureCoverage: {{AUTO_CONFIGURE_COVERAGE}},
})
