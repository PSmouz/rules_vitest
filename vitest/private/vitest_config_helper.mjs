import path from 'node:path'
import { pathToFileURL } from 'node:url'

function resolveRunfilesPath(rootpath) {
  return path.join(
    process.env.JS_BINARY__RUNFILES,
    process.env.JS_BINARY__WORKSPACE,
    rootpath,
  )
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
