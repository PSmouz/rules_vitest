import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

function stripEnclosingQuotes(value) {
  if (value.length >= 2) {
    const firstChar = value[0]
    const lastChar = value[value.length - 1]
    if ((firstChar === "'" && lastChar === "'") || (firstChar === '"' && lastChar === '"')) {
      return value.slice(1, -1)
    }
  }

  return value
}

function toLogicalRunfilePath(rootpath) {
  const normalizedRootpath = stripEnclosingQuotes(rootpath)
  return [process.env.JS_BINARY__WORKSPACE, ...normalizedRootpath.split(/[\\/]+/u).filter(Boolean)].join('/')
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

  if (fsSync.existsSync(physicalRunfilesPath)) {
    return physicalRunfilesPath
  }
  return physicalRunfilesPath
}

function extractRunfilesRootpath(candidatePath) {
  const normalizedPath = stripEnclosingQuotes(candidatePath)
  const normalizedSeparatorsPath = normalizedPath.replaceAll('\\', '/')
  const runfilesWorkspaceMarker = `/.runfiles/${process.env.JS_BINARY__WORKSPACE}/`

  if (normalizedSeparatorsPath.includes(runfilesWorkspaceMarker)) {
    return normalizedSeparatorsPath.split(runfilesWorkspaceMarker).pop()
  }

  if (normalizedSeparatorsPath.startsWith(`${process.env.JS_BINARY__WORKSPACE}/`)) {
    return normalizedSeparatorsPath.slice(process.env.JS_BINARY__WORKSPACE.length + 1)
  }

  if (!path.isAbsolute(normalizedPath)) {
    return normalizedSeparatorsPath
  }

  return null
}

function normalizeConfigPath(configPath) {
  const strippedPath = stripEnclosingQuotes(configPath)
  const runfilesRootpath = extractRunfilesRootpath(strippedPath)

  if (runfilesRootpath) {
    return resolveRunfilesPath(runfilesRootpath)
  }

  return strippedPath
}

async function touchShardStatusFile() {
  if (!process.env.TEST_TOTAL_SHARDS || !process.env.TEST_SHARD_STATUS_FILE) {
    return
  }

  await fs.mkdir(path.dirname(process.env.TEST_SHARD_STATUS_FILE), { recursive: true })
  await fs.writeFile(process.env.TEST_SHARD_STATUS_FILE, '')
}

function buildVitestArgs() {
  const args = process.argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--config' && args[index + 1]) {
      args[index + 1] = normalizeConfigPath(args[index + 1])
      index += 1
      continue
    }

    if (arg.startsWith('--config=')) {
      const [, configPath] = arg.split(/=(.*)/su)
      args[index] = `--config=${normalizeConfigPath(configPath)}`
    }
  }

  if (process.env.TEST_TOTAL_SHARDS) {
    const shardIndex = Number(process.env.TEST_SHARD_INDEX || '0') + 1
    const shardCount = Number(process.env.TEST_TOTAL_SHARDS)
    args.push(`--shard=${shardIndex}/${shardCount}`)
  }

  if (process.env.TESTBRIDGE_TEST_ONLY) {
    args.push(process.env.TESTBRIDGE_TEST_ONLY)
  }

  return args
}

async function loadSnapshotSync() {
  const helperUrl = pathToFileURL(
    resolveRunfilesPath(process.env.VITEST_BAZEL__SNAPSHOT_SYNC_HELPER_SHORT_PATH),
  ).href
  return import(helperUrl)
}

function normalizeCoverageSourcePath(sourcePath) {
  let nextPath = sourcePath

  if (nextPath.startsWith('file://')) {
    nextPath = fileURLToPath(nextPath)
  }

  const workspaceMarker = `${path.sep}_main${path.sep}`
  const runfilesMarker = `${path.sep}.runfiles${path.sep}_main${path.sep}`

  if (nextPath.includes(runfilesMarker)) {
    nextPath = nextPath.split(runfilesMarker).pop()
  } else if (nextPath.includes(workspaceMarker)) {
    nextPath = nextPath.split(workspaceMarker).pop()
  } else if (!path.isAbsolute(nextPath)) {
    const packagePath = process.env.JS_BINARY__PACKAGE || ''
    nextPath = packagePath ? path.posix.join(packagePath, nextPath) : nextPath
  }

  nextPath = nextPath.split(path.sep).join(path.posix.sep)

  if (
    nextPath.startsWith('vitest/private/') ||
    nextPath.includes('/vitest/private/') ||
    nextPath.endsWith('_test_vitest_wrapper.mjs') ||
    nextPath.endsWith('__vitest.config.mjs')
  ) {
    return null
  }

  return nextPath
}

async function writeBazelCoverageReport() {
  if (!process.env.COVERAGE_DIR || !process.env.COVERAGE_OUTPUT_FILE) {
    return
  }

  const vitestLcovPath = path.join(process.env.COVERAGE_DIR, 'vitest', 'lcov.info')
  const lcovSource = await fs.readFile(vitestLcovPath, 'utf8')
  const lines = lcovSource.split('\n')
  const nextLines = []
  let keepRecord = true

  for (const line of lines) {
    if (line.startsWith('SF:')) {
      const normalizedPath = normalizeCoverageSourcePath(line.slice(3))
      keepRecord = normalizedPath !== null
      if (keepRecord) {
        nextLines.push(`SF:${normalizedPath}`)
      }
      continue
    }

    if (line === 'end_of_record') {
      if (keepRecord) {
        nextLines.push(line)
      }
      keepRecord = true
      continue
    }

    if (keepRecord) {
      nextLines.push(line)
    }
  }

  await fs.writeFile(process.env.COVERAGE_OUTPUT_FILE, nextLines.join('\n'))
}

function nodeCommand() {
  return process.env.JS_BINARY__NODE_BINARY || process.execPath
}

async function runQuietly(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    const stdout = []
    const stderr = []

    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        process.stdout.write(Buffer.concat(stdout))
        process.stderr.write(Buffer.concat(stderr))
      }
      resolve(code ?? 1)
    })
  })
}

async function runWithInheritedStdio(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function main() {
  await touchShardStatusFile()
  await fs.realpath(process.cwd()).then((cwd) => process.chdir(cwd))

  const vitestCliPath = resolveRunfilesPath(process.env.VITEST_BAZEL__VITEST_CLI_RUNFILES_PATH)
  const args = [
    ...(process.platform === 'win32' && process.env.JS_BINARY__NODE_PATCHES
      ? ['--require', process.env.JS_BINARY__NODE_PATCHES]
      : []),
    vitestCliPath,
    ...buildVitestArgs(),
  ]
  const env = {
    ...process.env,
    CI: 'true',
    VITEST_SKIP_INSTALL_CHECKS: '1',
  }

  const quietUpdates =
    process.env.VITEST_BAZEL__UPDATE_SNAPSHOTS === '1' &&
    process.env.VITEST_BAZEL__QUIET_SNAPSHOT_UPDATES === '1'
  const exitCode = quietUpdates
    ? await runQuietly(nodeCommand(), args, env)
    : await runWithInheritedStdio(nodeCommand(), args, env)

  if (exitCode === 0) {
    await writeBazelCoverageReport()
  }

  if (exitCode === 0 && process.env.VITEST_BAZEL__UPDATE_SNAPSHOTS === '1') {
    const snapshotManifestPath = resolveRunfilesPath(
      process.env.VITEST_BAZEL__SNAPSHOT_MANIFEST_SHORT_PATH,
    )
    const { syncSnapshots } = await loadSnapshotSync()
    await syncSnapshots(snapshotManifestPath)
  }

  process.exit(exitCode)
}

await main()
