import fs from 'node:fs/promises'
import path from 'node:path'

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function listSnapshotFiles(dirPath, ext) {
  if (!(await exists(dirPath))) {
    return []
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listSnapshotFiles(nextPath, ext))
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      files.push(nextPath)
    }
  }
  return files
}

async function copyFile(fromPath, toPath) {
  await ensureDir(path.dirname(toPath))
  await fs.copyFile(fromPath, toPath)
}

async function syncSnapshotDir(runfilesPackageDir, workspacePackageDir, relativeDir, ext) {
  const runfilesDir = path.join(runfilesPackageDir, relativeDir)
  const workspaceDir = path.join(workspacePackageDir, relativeDir)

  const runfilesFiles = await listSnapshotFiles(runfilesDir, ext)
  const workspaceFiles = await listSnapshotFiles(workspaceDir, ext)

  const runfilesRelative = new Set(
    runfilesFiles.map((filePath) => path.relative(runfilesDir, filePath)),
  )
  const workspaceRelative = new Set(
    workspaceFiles.map((filePath) => path.relative(workspaceDir, filePath)),
  )

  for (const relativeFile of runfilesRelative) {
    await copyFile(
      path.join(runfilesDir, relativeFile),
      path.join(workspaceDir, relativeFile),
    )
  }

  for (const relativeFile of workspaceRelative) {
    if (!runfilesRelative.has(relativeFile)) {
      await fs.rm(path.join(workspaceDir, relativeFile), { force: true })
    }
  }
}

async function syncSnapshotFile(runfilesPackageDir, workspacePackageDir, relativeFile) {
  const runfilesFile = path.join(runfilesPackageDir, relativeFile)
  const workspaceFile = path.join(workspacePackageDir, relativeFile)

  if (await exists(runfilesFile)) {
    await copyFile(runfilesFile, workspaceFile)
  } else {
    await fs.rm(workspaceFile, { force: true })
  }
}

export async function syncSnapshots(manifestPath) {
  if (!manifestPath) {
    return
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const workspaceRoot = process.env.BUILD_WORKSPACE_DIRECTORY

  if (!workspaceRoot) {
    throw new Error('BUILD_WORKSPACE_DIRECTORY is required for snapshot updates')
  }

  const packagePath = manifest.package || ''
  const runfilesPackageDir = path.join(
    process.env.JS_BINARY__RUNFILES,
    process.env.JS_BINARY__WORKSPACE,
    packagePath,
  )
  const workspacePackageDir = path.join(workspaceRoot, packagePath)

  for (const relativeDir of manifest.dirs || []) {
    await syncSnapshotDir(runfilesPackageDir, workspacePackageDir, relativeDir, manifest.ext)
  }

  for (const relativeFile of manifest.files || []) {
    await syncSnapshotFile(runfilesPackageDir, workspacePackageDir, relativeFile)
  }
}
