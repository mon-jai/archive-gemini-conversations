import { mkdir, writeFile } from "fs/promises"
import { join } from "path"

import { queue } from "async"
import { type Browser, chromium } from "playwright"

import { ARCHIVE_DIR } from "./constants.js"
import {
  archiveConversation,
  buildCommitMessage,
  deleteFile,
  getArchivedConversations,
  getGeminiIdsFromMarkdowns
} from "./util.js"

await mkdir(ARCHIVE_DIR, { recursive: true })

const listedIds = await getGeminiIdsFromMarkdowns()
const archivedMap = await getArchivedConversations(ARCHIVE_DIR)
const archivedIds = new Set(archivedMap.keys())

const newIds = [...listedIds].filter(id => !archivedIds.has(id))
const staleIds = [...archivedIds].filter(id => !listedIds.has(id))

// Delete stale
const deleted: string[] = []
for (const id of staleIds) {
  const file = join(ARCHIVE_DIR, archivedMap.get(id)!)
  if (await deleteFile(file)) deleted.push(id)
}

// Archive new conversations with async.queue
const added: string[] = []
const errored: string[] = []
let browser: Browser | null = null

try {
  browser = await chromium.launch({ args: ["--disable-web-security"] })

  const archiveQueue = queue<string>(async (id, callback) => {
    try {
      await archiveConversation(browser!, id)
      added.push(id)
    } catch (error) {
      errored.push(id)
    }
    callback()
  }, 10)

  archiveQueue.push(newIds)
  await archiveQueue.drain()
} finally {
  if (browser) await browser.close()
}

// Compose commit message and output it for workflow
const commitMessage = buildCommitMessage(added, deleted)
await writeFile(".git/commit-msg", commitMessage, "utf8")
