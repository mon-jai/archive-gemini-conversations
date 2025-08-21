import { glob, readFile, readdir, writeFile } from "fs/promises"
import { join } from "path"

import type { Browser } from "playwright"
import sanitize from "sanitize-filename"

import { ARCHIVE_DIR, HOOK_SCRIPT, SCRIPT, WORKSPACE_ROOT, ZIP_SCRIPT } from "./constants.js"

export async function getGeminiIdsFromMarkdowns(): Promise<Set<string>> {
  const ids = new Set<string>()
  const markdownFiles = glob(`${WORKSPACE_ROOT}/**/*.md`)

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
    const match = file.match(/^(?<id>[a-z0-9-]+) - .*\.html$/)
    if (match) map.set(match.groups?.["id"] as string, file)
  }

  return map
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

    // In some shared conversations, title does not exists
    // page.evaluate: TypeError: Cannot read properties of null (reading 'textContent')
    const title = (await page.evaluate(() => document.querySelector("h1 > strong")?.textContent, "")) ?? ""
    const includesKatex = await page.evaluate(() => document.getElementsByClassName("katex").length > 0)

    await page.evaluate(async () => {
      // ----- Toggling buttons to expand truncated contents -----
      // Expand "Research Websites" section in Deep Research metadata
      document.querySelector<HTMLButtonElement>('[data-test-id="toggle-description-expansion-button"]')?.click()
      // Expand instructions text for the Gemini Gem used in the conversation
      document.querySelector<HTMLButtonElement>('[data-test-id="bot-instruction-see-more-button"]')?.click()

      // ----- Remove unnecessary elements from the page -----
      // About Gemini section
      document.getElementsByTagName("top-bar-actions")[0]?.remove()
      // Sign-in buttons
      document.getElementsByClassName("boqOnegoogleliteOgbOneGoogleBar")[0]?.remove()
      document.getElementsByClassName("share-landing-page_footer")[0]?.remove()
      // Copy and flag buttons
      const linkActionButtons = document.getElementsByClassName("link-action-buttons")?.[0]?.children
      if (linkActionButtons) while (linkActionButtons.length > 0) linkActionButtons[0]!.remove()
      // Disclaimer section
      document.getElementsByClassName("share-viewer_footer_disclaimer")[0]?.remove()
      // Legal links
      const legalLinks = document.getElementsByClassName("share-viewer_legal-links")[0] as HTMLDivElement | undefined
      if (legalLinks) {
        legalLinks.style.paddingTop = "0"
        while (legalLinks.children.length > 0) legalLinks.children[0]!.remove()
      }
      // Script tags
      const scriptTags = document.getElementsByTagName("script")
      while (scriptTags.length > 0) scriptTags[0]!.remove()
      // tts-control causes blank spaces at the end of some pages, while isn't displaying anything
      const ttsControls = document.getElementsByTagName("tts-control")
      while (ttsControls.length > 0) ttsControls[0]!.remove()

      // ----- Replace font-based <mat-icon /> with their SVG equivalents to reduce bundle size -----
      // For example, expand button for chain of thought, Deep Research steps, etc.
      const matIcons = document.getElementsByTagName("mat-icon")
      while (matIcons.length > 0) {
        const matIcon = matIcons[0]!
        const iconComputedStyle = getComputedStyle(matIcon)
        const color = iconComputedStyle.color
        let iconName = matIcon.getAttribute("fonticon")
        let size = parseInt(iconComputedStyle.fontSize)

        if (iconName === "drive_spreadsheet") iconName = "table"
        if (size < 20) size = 20

        // https://stackoverflow.com/a/43916743/
        const newIconEl = document.createElement("div")
        newIconEl.style.backgroundColor = color
        newIconEl.style.mask = `url(https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsrounded/${iconName}/default/${size}px.svg)`
        newIconEl.style.width = `${size}px`
        newIconEl.style.height = `${size}px`
        matIcon.insertAdjacentElement("afterend", newIconEl)
        matIcon.remove()
      }
    })

    // @ts-expect-error
    const pageData: { content: string } = await page.evaluate(async options => await singlefile.getPageData(options), {
      // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/single-file-cli-api.js#L258
      // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/lib/cdp-client.js#L332
      // https://github.com/gildas-lormeau/single-file-core/blob/212a657/single-file.js#L125
      zipScript: ZIP_SCRIPT,

      removeUnusedStyles: true,
      removeUnusedFonts: true,
      removeFrames: true,
      insertSingleFileComment: true
    })

    const variablesUsedInDocument = new Set(
      // Variable values could contain other values, so /var\(([^\)]+)/g won't work
      // e.g. --a: var(--b, var(--c));
      Array.from(pageData.content.matchAll(/var\s*\(\s*(?<variableName>--[A-Za-z0-9\-]+)/g)).map(
        regExpExecArray => regExpExecArray.groups!["variableName"]!
      )
    )

    const fileContent = pageData.content
      // Remove fonts
      .replaceAll(/@font-face\s*{[^}]*}/g, (fontFaceRule: string) => {
        const fontFamilyMatch = fontFaceRule.match(/font-family:\s*(?<quote>['"]?)(?<fontFamily>[^'"]+)\k<quote>/)
        const fontFamily = fontFamilyMatch?.groups?.["fontFamily"]?.trim() ?? ""

        if (includesKatex && fontFamily.startsWith("KaTeX")) return fontFaceRule
        return ""
      })
      // Remove unused CSS variable decelerations
      .replaceAll(
        // <div style="--a: 0px"> ...
        // <div style='--a: 0px'> ...
        /(?<variableName>--[A-Za-z0-9\-]+)\s*:\s*(?<value>(?:(?!["']\s*>)[^;\n\}])+);?/gm,
        (_match, variableName: string, value: string) => {
          if (variablesUsedInDocument.has(variableName)) return `${variableName}:${value};`
          return ""
        }
      )

    // Remove illegal filename chars
    const sanitizedTitle = sanitize(title).substring(0, 100)
    const filepath = join(ARCHIVE_DIR, `${id} - ${sanitizedTitle}.html`)
    await writeFile(filepath, fileContent)
  } catch (error) {
    console.error(`Failed to archive ${id}: ${(error as Error).message}`)
    throw error
  } finally {
    if (page) await page.close()
  }
}

export function buildCommitMessage(added: string[], deleted: string[]): string {
  let message = "chore: automatic update of conversation archive\n"

  if (added.length > 0) message += `\nAdded conversations: ${added.join(", ")}`
  if (deleted.length > 0) message += `\nDeleted conversations: ${deleted.join(", ")}`

  return message
}
