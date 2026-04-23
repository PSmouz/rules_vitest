import path from 'node:path'
import fsSync from 'node:fs'
import { pathToFileURL } from 'node:url'

let runfilesManifest

function getRunfilesManifest() {
  if (runfilesManifest !== undefined) {
    return runfilesManifest
  }

  const manifestPath =
    process.env.RUNFILES_MANIFEST_FILE ||
    [
      process.env.JS_BINARY__RUNFILES ? `${process.env.JS_BINARY__RUNFILES}_manifest` : null,
      process.env.JS_BINARY__RUNFILES ? path.join(process.env.JS_BINARY__RUNFILES, 'MANIFEST') : null,
    ].find((candidatePath) => candidatePath && fsSync.existsSync(candidatePath))

  if (!manifestPath) {
    runfilesManifest = null
    return runfilesManifest
  }

  runfilesManifest = new Map()

  for (const line of fsSync.readFileSync(manifestPath, 'utf8').split(/\r?\n/u)) {
    if (!line) {
      continue
    }

    const separatorIndex = line.indexOf(' ')
    if (separatorIndex === -1) {
      continue
    }

    runfilesManifest.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1))
  }

  return runfilesManifest
}

function toLogicalRunfilePath(rootpath) {
  return [process.env.JS_BINARY__WORKSPACE, ...rootpath.split(/[\\/]+/u).filter(Boolean)].join('/')
}

function resolveManifestPath(logicalRunfilePath, seen = new Set()) {
  const manifest = getRunfilesManifest()
  if (!manifest || seen.has(logicalRunfilePath)) {
    return null
  }

  seen.add(logicalRunfilePath)

  const directTarget = manifest.get(logicalRunfilePath)
  if (directTarget) {
    if (path.isAbsolute(directTarget)) {
      return directTarget
    }

    const redirectedLogicalPath = path.posix.normalize(
      path.posix.join(path.posix.dirname(logicalRunfilePath), directTarget),
    )

    return (
      resolveManifestPath(redirectedLogicalPath, seen) ||
      path.resolve(process.env.JS_BINARY__RUNFILES, path.posix.dirname(logicalRunfilePath), directTarget)
    )
  }

  const parentLogicalPath = path.posix.dirname(logicalRunfilePath)
  if (parentLogicalPath === logicalRunfilePath || parentLogicalPath === '.') {
    return null
  }

  const parentResolvedPath = resolveManifestPath(parentLogicalPath, seen)
  if (!parentResolvedPath) {
    return null
  }

  const relativeSuffix = path.posix.relative(parentLogicalPath, logicalRunfilePath)
  return path.join(parentResolvedPath, ...relativeSuffix.split('/'))
}

function resolveRunfilesPath(rootpath) {
  const logicalRunfilePath = toLogicalRunfilePath(rootpath)
  const physicalRunfilesPath = path.join(process.env.JS_BINARY__RUNFILES, logicalRunfilePath)

  const manifestResolvedPath = resolveManifestPath(logicalRunfilePath)
  if (manifestResolvedPath) {
    return manifestResolvedPath
  }

  return physicalRunfilesPath
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
