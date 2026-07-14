import { mkdir, unlink, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { asyncify, queue, retry } from "async"
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
const archiveQueue = queue<string>(async id => {
  // The latest version of the `single-file-cli` package introduced an error that happens occasionally
  // Retry up to 10 times if it occurs
  // Full error: {"instanceOf":"PlaywrightError","stack":"page.evaluate: SyntaxError: Failed to execute 'matches' on 'Element': '>:first-child' is not a valid selector.\n    at EL (<anonymous>:169:24500)\n    at SL (<anonymous>:169:24341)\n    at vL (<anonymous>:169:24211)\n    at bL (<anonymous>:169:23490)\n    at mL (<anonymous>:169:21180)\n    at dL (<anonymous>:169:20867)\n    at iL (<anonymous>:169:19724)\n    at bo (<anonymous>:169:19322)\n    at lL (<anonymous>:169:20577)\n    at iL (<anonymous>:169:19589)\n    at archiveConversation (D:\\GitHub\\archive\\src\\archive.ts:216:35)\n    at async file:///D:/GitHub/archive/src/index.ts:30:5","message":"page.evaluate: SyntaxError: Failed to execute 'matches' on 'Element': '>:first-child' is not a valid selector.\n    at EL (<anonymous>:169:24500)\n    at SL (<anonymous>:169:24341)\n    at vL (<anonymous>:169:24211)\n    at bL (<anonymous>:169:23490)\n    at mL (<anonymous>:169:21180)\n    at dL (<anonymous>:169:20867)\n    at iL (<anonymous>:169:19724)\n    at bo (<anonymous>:169:19322)\n    at lL (<anonymous>:169:20577)\n    at iL (<anonymous>:169:19589)","log":[],"name":"Error"}
  const retryPromise = retry(
    { times: 10, errorFilter: (error: Error) => error.message.includes(">:first-child") },
    // `async.retry()` distinguishes between native async functions and regular functions
    // For the latter, it assumes a Node-style callback
    asyncify(() => archiveConversation(id, browser))
  )
  return retryPromise.catch(error => console.error(`Failed to archive ${id}: ${error.message}`))
}, 10)
archiveQueue.push(newIds)
await archiveQueue.drain()

// Compose commit message and output it for the workflow
const commitMessage = buildCommitMessage(newIds, staleIds)
await writeFile(resolve(WORKSPACE_ROOT, "./.git/commit-msg"), commitMessage, "utf8")
