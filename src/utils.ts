import { glob, readdir, readFile } from "fs/promises"

import { WORKSPACE_ROOT } from "./constants.ts"

export async function getGeminiIdsFromMarkdowns(): Promise<Set<string>> {
  const ids = new Set<string>()
  const markdownFiles = glob(`${WORKSPACE_ROOT}/**/*.md`)

  for await (const markdownFile of markdownFiles) {
    const readme = await readFile(markdownFile, "utf8")
    const matches = readme.matchAll(/https:\/\/(?:gemini\.google\.com|g\.co\/gemini)\/share\/(?<id>[^/\s]+)/g)
    for (const match of matches) ids.add(match.groups!["id"]!)
  }

  return ids
}

export async function getArchivedConversations(archiveDir: string): Promise<Map<string, string>> {
  const files = await readdir(archiveDir)
  const map = new Map<string, string>()

  for (const file of files) {
    const match = file.match(/^(?<id>[a-z0-9-]+) - .*\.html$/)
    if (match) map.set(match.groups!["id"] as string, file)
  }

  return map
}

export function buildCommitMessage(added: string[], deleted: string[]): string {
  let message = "chore: automatic update of conversation archive\n"

  if (added.length > 0) message += `\nAdded conversations: ${added.join(", ")}`
  if (deleted.length > 0) message += `\nDeleted conversations: ${deleted.join(", ")}`

  return message
}
