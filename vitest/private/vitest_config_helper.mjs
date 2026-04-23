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

async function loadUserConfig(userConfigShortPath) {
  if (!userConfigShortPath) {
    return {}
  }

  const { loadConfigFromFile } = await import(
    pathToFileURL(
      resolveRunfilesPath(process.env.VITEST_BAZEL__VITE_RUNFILES_PATH),
    ).href,
  )

  const configPath = resolveRunfilesPath(userConfigShortPath)
  const loaded = await loadConfigFromFile(
    {
      command: 'serve',
      mode: 'test',
      isSsrBuild: false,
      isPreview: false,
    },
    configPath,
    process.cwd(),
    undefined,
    undefined,
    'runner',
  )

  return loaded?.config ?? {}
}

function reporterName(reporter) {
  if (Array.isArray(reporter)) {
    return reporter[0]
  }
  return typeof reporter === 'string' ? reporter : null
}

function normalizeReporters(reporters) {
  if (!reporters) {
    return []
  }
  return Array.isArray(reporters) ? [...reporters] : [reporters]
}

function addReporter(reporters, nextReporter) {
  if (!reporters.some((reporter) => reporterName(reporter) === reporterName(nextReporter))) {
    reporters.push(nextReporter)
  }
}

function normalizeCoverageReporters(reporters, file) {
  const result = !reporters
    ? []
    : Array.isArray(reporters)
      ? [...reporters]
      : [reporters]

  if (!result.some((reporter) => reporterName(reporter) === 'text')) {
    result.push('text')
  }
  if (!result.some((reporter) => reporterName(reporter) === 'lcovonly')) {
    result.push(['lcovonly', { file }])
  }

  return result
}

export async function createBazelVitestConfig(options) {
  const config = await loadUserConfig(options.userConfigShortPath)
  const next = typeof config === 'object' && config != null ? config : {}
  const test = typeof next.test === 'object' && next.test != null ? { ...next.test } : {}

  test.watch = false
  test.ui = false
  test.open = false

  if (options.autoConfigureReporters) {
    const reporters = normalizeReporters(test.reporters)
    addReporter(reporters, 'default')
    if (process.env.XML_OUTPUT_FILE) {
      addReporter(reporters, 'junit')
      test.outputFile = {
        ...(typeof test.outputFile === 'object' && test.outputFile != null ? test.outputFile : {}),
        junit: process.env.XML_OUTPUT_FILE,
      }
    }
    test.reporters = reporters
  }

  if (options.autoConfigureCoverage && process.env.COVERAGE_OUTPUT_FILE) {
    const reportsDirectory = process.env.COVERAGE_DIR
      ? path.join(process.env.COVERAGE_DIR, 'vitest')
      : path.dirname(process.env.COVERAGE_OUTPUT_FILE)

    const coverage = typeof test.coverage === 'object' && test.coverage != null
      ? { ...test.coverage }
      : {}

    coverage.enabled = true
    coverage.provider = 'v8'
    coverage.all = true
    coverage.reportsDirectory = reportsDirectory
    coverage.reportOnFailure = true
    coverage.include = coverage.include || [
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.ts',
      '**/*.cts',
      '**/*.mts',
      '**/*.jsx',
      '**/*.tsx',
    ]
    coverage.exclude = coverage.exclude || [
      '**/*.test.*',
      '**/*.spec.*',
      '**/__snapshots__/**',
      '**/__snaps__/**',
      '**/node_modules/**',
      '**/*.config.*',
      '**/*__vitest.config.mjs',
    ]
    coverage.reporter = normalizeCoverageReporters(coverage.reporter, 'lcov.info')
    test.coverage = coverage
  }

  next.test = test

  if (process.env.JS_BINARY__LOG_DEBUG) {
    console.error(
      'DEBUG: rules_vitest[vitest_test] config:',
      JSON.stringify(next, null, 2),
    )
  }

  return next
}
