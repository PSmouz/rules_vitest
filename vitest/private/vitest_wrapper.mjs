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

  const manifestPath = process.env.RUNFILES_MANIFEST_FILE
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

function resolveRunfilesPath(rootpath) {
  const logicalRunfilePath = path.join(process.env.JS_BINARY__WORKSPACE, rootpath)
  const physicalRunfilesPath = path.join(process.env.JS_BINARY__RUNFILES, logicalRunfilePath)

  if (fsSync.existsSync(physicalRunfilesPath)) {
    return physicalRunfilesPath
  }

  const manifest = getRunfilesManifest()
  return manifest?.get(logicalRunfilePath) ?? physicalRunfilesPath
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
