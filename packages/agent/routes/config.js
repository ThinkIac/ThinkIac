import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = join(PKG_DIR, '..', '..')
const SNAP_DIR = join(PKG_DIR, 'snapshots', 'core')






















