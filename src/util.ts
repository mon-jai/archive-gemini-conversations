import { glob, readFile, readdir, unlink, writeFile } from "fs/promises"
import { join } from "path"

import type { Browser } from "playwright"

import { ARCHIVE_DIR, HOOK_SCRIPT, SCRIPT, ZIP_SCRIPT } from "./constants.js"

export async function getGeminiIdsFromMarkdowns(): Promise<Set<string>> {
  const ids = new Set<string>()
  const markdownFiles = glob("**/*.md")

  for await (const markdownFile of markdownFiles) {
    const readme = await readFile(markdownFile, "utf8")
    const matches = readme.matchAll(/https:\/\/(?:gemini\.google\.com|g\.co\/gemini)\/share\/(?<id>[^\/\s]+)/g)
    for (const match of matches) ids.add(match.groups!["id"]!)
  }

  return ids
}

export async function getArchivedConversations(archiveDir: string): Promise<Map<string, string>> {
  const files = await readdir(archiveDir)
  const map = new Map<string, string>()

  for (const file of files) {
    const match = file.match(/^(?<id>[^-]+) - .+\.html$/)
    if (match) map.set(match.groups?.["id"] as string, file)
  }

  return map
}

export async function deleteFile(filePath: string) {
  return await unlink(filePath)
    .then(() => true)
    .catch(() => false)
}

export async function archiveConversation(browser: Browser, id: string) {
  const url = `https://gemini.google.com/share/${id}`
  let page

  try {
    page = await browser.newPage({ bypassCSP: true })
    // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/lib/cdp-client.js#L235-L243
    await page.addInitScript({ content: HOOK_SCRIPT })
    await page.addInitScript({ content: SCRIPT })

    await page.goto(url)
    await page.waitForSelector("message-content", { timeout: 20000 })
    await page.waitForTimeout(3000)

    // Click all visible elements with text starting with "Show"
    const showButtons = await page.getByText("Show").all()
    for (const btn of showButtons) {
      if (await btn.isVisible()) await btn.click()
    }

    // @ts-expect-error
    const title = (await page.evaluate(() => document.querySelector("h1 > strong").textContent, "")) ?? ""

    // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/single-file-cli-api.js#L258
    // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/lib/cdp-client.js#L332
    // https://github.com/gildas-lormeau/single-file-core/blob/212a657/single-file.js#L125
    // @ts-expect-error
    const pageData = await page.evaluate(async options => await singlefile.getPageData(options), {
      zipScript: ZIP_SCRIPT
    })

    const fileContent = pageData.content
      .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>\s*/gi, "")
      .replaceAll(/@font-face\s*{[^}]*}/g, (fontFaceRule: string) => {
        const fontFamilyMatch = fontFaceRule.match(/font-family:\s*(?<quote>['"]?)(?<fontFamily>[^'"]+)\k<quote>;/)

        if (fontFamilyMatch && fontFamilyMatch.groups?.["fontFamily"]) {
          const fontFamily = fontFamilyMatch.groups?.["fontFamily"].trim()
          if (fontFamily === "Google Symbols") return fontFaceRule
          if (pageData.content.includes(`class="katex"`) && fontFamily.startsWith("KaTeX")) return fontFaceRule
        }

        return ""
      })

    // Remove illegal filename chars
    const sanitizedTitle = title.replace(/[\\/:*?"<>|\n]/g, "").substring(0, 100)
    const filepath = join(ARCHIVE_DIR, `${id} - ${sanitizedTitle}.html`)
    await writeFile(filepath, fileContent)

    await page.close()
  } catch (err) {
    if (page) await page.close()

    console.error(`Failed to archive ${id}: ${(err as Error).message}`)
    throw err
  }
}

export function buildCommitMessage(added: string[], deleted: string[]): string {
  let msg = "chore: Automatic conversation archive\n"

  if (added.length > 0) msg += `\nAdded conversations: ${added.join(", ")}`
  if (deleted.length > 0) msg += `\nDeleted conversations: ${deleted.join(", ")}`

  return msg
}
