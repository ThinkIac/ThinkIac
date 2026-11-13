import { existsSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"

const PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]*$/i

export function clearCompiledViewCache(cacheDir, packageName = null) {
  if (packageName != null && (typeof packageName !== "string" || !PACKAGE_NAME.test(packageName))) {
    return {
      success: false,
      removed: 0,
      errors: [],
      package: packageName,
      message: "Invalid package name",
    }
  }

  let removed = 0
  const errors = []
  const prefix = packageName ? `${packageName}__` : null

  try {
    if (existsSync(cacheDir)) {
      for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
        // Source helpers in this directory are inputs to the build pipeline,
        // not disposable output. Directories and links are never traversed.
        if (!entry.isFile() || entry.name.endsWith(".svelte")) continue
        if (prefix && !entry.name.startsWith(prefix)) continue
        try {
          unlinkSync(join(cacheDir, entry.name))
          removed++
        } catch (error) {
          errors.push(`${entry.name}: ${error.message}`)
        }
      }
    }
  } catch (error) {
    errors.push(error.message)
  }

  const scope = packageName ? ` for package ${packageName}` : ""
  const message = errors.length
    ? `Cache cleared${scope} (${removed} file${removed === 1 ? "" : "s"} removed, ${errors.length} failed)`
    : `Cache cleared${scope} (${removed} file${removed === 1 ? "" : "s"} removed)`

  return { success: errors.length === 0, removed, errors, package: packageName, message }
}
