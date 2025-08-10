// @ts-expect-error
import { getHookScriptSource, getScriptSource, getZipScriptSource } from "single-file-cli/lib/single-file-script.js"

export const ARCHIVE_DIR = "./conversations"

export const SCRIPT = (await getScriptSource({})) + "; window.singlefile = singlefile"
export const HOOK_SCRIPT = getHookScriptSource()
export const ZIP_SCRIPT = getZipScriptSource()
