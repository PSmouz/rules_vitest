import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

function resolveRunfilesPath(rootpath) {
  return path.join(
    process.env.JS_BINARY__RUNFILES,
    process.env.JS_BINARY__WORKSPACE,
    rootpath,
  )
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

  const vitestCliPath = resolveRunfilesPath(process.env.VITEST_BAZEL__VITEST_CLI_RUNFILES_PATH)
  const args = [vitestCliPath, ...buildVitestArgs()]
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
