import { mkdir, unlink, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { queue } from "async"
import { chromium } from "playwright"

import { ARCHIVE_DIR, WORKSPACE_ROOT } from "./constants.js"
import { archiveConversation, buildCommitMessage, getArchivedConversations, getGeminiIdsFromMarkdowns } from "./util.js"

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
const archiveQueue = queue<string>(async (id, callback) => {
  try {
    await archiveConversation(browser!, id)
    callback()
  } catch (error) {
    console.error(`Failed to archive ${id}: ${(error as Error).message}`)
  }
}, 10)
archiveQueue.push(newIds)
await archiveQueue.drain()

// Compose commit message and output it for the workflow
const commitMessage = buildCommitMessage(newIds, staleIds)
await writeFile(resolve(WORKSPACE_ROOT, "./.git/commit-msg"), commitMessage, "utf8")
