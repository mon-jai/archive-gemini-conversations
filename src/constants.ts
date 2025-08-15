import { resolve } from "path"

// @ts-expect-error
import { getHookScriptSource, getScriptSource, getZipScriptSource } from "single-file-cli/lib/single-file-script.js"

export const WORKSPACE_ROOT = process.argv.at(-1)!
export const ARCHIVE_DIR = resolve(WORKSPACE_ROOT, "./conversations")

export const SCRIPT = (await getScriptSource({})) + "; window.singlefile = singlefile"
export const HOOK_SCRIPT = getHookScriptSource()
export const ZIP_SCRIPT = getZipScriptSource()
