import { resolve } from "path"

// @ts-expect-error
import { hookScript, script, zipScript } from "single-file-cli/lib/single-file-bundle.js"

// ["node", ".", "<path>"]
export const WORKSPACE_ROOT = process.argv[2] ?? process.cwd()
export const ARCHIVE_DIR = resolve(WORKSPACE_ROOT, "./conversations")

export const SCRIPT = script + "; window.singlefile = singlefile"
export const HOOK_SCRIPT = hookScript
export const ZIP_SCRIPT = zipScript
