import { glob, readFile, readdir, unlink, writeFile } from "fs/promises"
import { join } from "path"

import type { Browser } from "playwright"

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
    const match = file.match(/^(?<id>[^-]+) - .*\.html$/)
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

    // Click all visible elements with text "Show"
    for (const btn of await page.getByText("Show").all()) await btn.click()
    // Click all visible elements with text "More" (Deep Research)
    for (const btn of await page.getByText("More").all()) await btn.click()

    // In some shared conversations, title does not exists
    // page.evaluate: TypeError: Cannot read properties of null (reading 'textContent')
    const title = (await page.evaluate(() => document.querySelector("h1 > strong")?.textContent, "")) ?? ""
    const includesKatex = await page.evaluate(() => document.getElementsByClassName("katex").length > 0)

    // Remove unnecessary elements from the page
    await page.evaluate(async () => {
      // About Gemini
      document.getElementsByTagName("top-bar-actions")[0]?.remove()

      // Sign in buttons
      document.getElementsByClassName("boqOnegoogleliteOgbOneGoogleBar")[0]?.remove()
      document.getElementsByClassName("share-landing-page_footer")[0]?.remove()

      // Copy and flag buttons
      for (const matButton of document.querySelectorAll("[mat-icon-button]")) matButton.remove()

      // Replace mat-icon with equivalent SVGs, as the icon font is heavy
      // e.g. expand button for reasoning steps, Deep Research steps
      const matIcons = document.getElementsByTagName("mat-icon")
      while (matIcons.length > 0) {
        const matIcon = matIcons[0]!
        const iconName = matIcon.getAttribute("fonticon")
        const size = getComputedStyle(matIcon).fontSize

        const img = document.createElement("img")
        img.src = `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/${iconName}/default/${size}.svg`
        matIcon.insertAdjacentElement("afterend", img)
        matIcon.remove()
      }

      // Disclaimer
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

      // Remove inline CSS variables to make the later step of removing unused CSS variables easier
      // <div style="--a: 0px"> ...
      // <div style='--a: 0px'> ...
      for (const elWithStyleAttribute of document.querySelectorAll("[style]")) {
        if (elWithStyleAttribute.getAttribute("style")!.includes("--")) elWithStyleAttribute.removeAttribute("style")
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
      // Remove unused CSS variables
      .replaceAll(
        // --a: 0px; } .class { ...
        /(?<variableName>--[A-Za-z0-9\-]+)\s*:\s*(?<value>[^;\n\}]+)\s*[;\n]?(?<curlyBrace>\})?/gm,
        (_match, variableName: string, value: string, curlyBrace: string | undefined = "") => {
          if (variablesUsedInDocument.has(variableName)) return `${variableName}:${value};${curlyBrace}`
          return curlyBrace
        }
      )

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
