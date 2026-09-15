import { mkdir, unlink, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { queue } from "async"
import { chromium } from "playwright"

import { archiveConversation } from "./archive.ts"
import { ARCHIVE_DIR, WORKSPACE_ROOT } from "./constants.ts"
import { buildCommitMessage, getArchivedConversations, getGeminiIdsFromMarkdowns } from "./utils.ts"

await mkdir(ARCHIVE_DIR, { recursive: true })

const listedIds = await getGeminiIdsFromMarkdowns()
const archivedMap = await getArchivedConversations(ARCHIVE_DIR)
const archivedIds = new Set(archivedMap.keys())

const newIds = [...listedIds].filter(id => !archivedIds.has(id))
const staleIds = [...archivedIds].filter(id => !listedIds.has(id))

// Delete stale conversations
for (const id of staleIds) {
  const filePath = join(ARCHIVE_DIR, archivedMap.get(id)!)
  await unlink(filePath)
}

// Archive new conversations, at most 10 concurrently
await using browser = await chromium.launch({ args: ["--disable-web-security"] })
const archiveQueue = queue<string>(
  // The `async` library checks function types to determine control flow.
  // For an `async` function, the library knows it returns a promise and waits for it to settle.
  // Without the `async` keyword, the library assumes this is a traditional callback-based function,
  // passes a trailing callback argument (which is ignored by our code), and hangs indefinitely.
  // https://github.com/caolan/async/issues/1733#issuecomment-719984164
  async id => archiveConversation(id, browser).catch(err => console.error(`Failed to archive ${id}: ${err.message}`)),
  10
)
archiveQueue.push(newIds)
await archiveQueue.drain()

// Compose commit message and output it for the workflow
const commitMessage = buildCommitMessage(newIds, staleIds)
await writeFile(resolve(WORKSPACE_ROOT, "./.git/commit-msg"), commitMessage, "utf8")
