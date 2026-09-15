import { readFileSync } from "fs"
import { resolve } from "path"
import { fileURLToPath } from "url"

function readSingleFileScript(fileName: string) {
  return readFileSync(fileURLToPath(import.meta.resolve(`single-file/lib/${fileName}`)), "utf8")
}

// ["node", ".", "<path>"]
export const WORKSPACE_ROOT = process.argv[2] ?? process.cwd()
export const ARCHIVE_DIR = resolve(WORKSPACE_ROOT, "./conversations")

export const SCRIPT = readSingleFileScript("single-file.js")
export const HOOK_SCRIPT = readSingleFileScript("single-file-hooks-frames.js")
export const ZIP_SCRIPT = readSingleFileScript("single-file-zip.js")
