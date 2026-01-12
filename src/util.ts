import { glob, readdir, readFile, writeFile } from "fs/promises"
import { join } from "path"

import type { Browser } from "playwright"
import sanitize from "sanitize-filename"

import { ARCHIVE_DIR, HOOK_SCRIPT, SCRIPT, WORKSPACE_ROOT, ZIP_SCRIPT } from "./constants.js"

declare namespace singlefile {
  function getPageData(options: Record<string, any>): Promise<{ content: string }>
}

type DummyTagFunction = (...args: Parameters<typeof String.raw>) => string

// @ts-expect-error
const html: DummyTagFunction = (template, ...substitutions) => String.raw({ raw: template }, ...substitutions)

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
    if (match) map.set(match.groups!["id"] as string, file)
  }

  return map
}

export async function archiveConversation(id: string, browser: Browser) {
  const url = `https://gemini.google.com/share/${id}`

  await using page = await browser.newPage({ bypassCSP: true })
  // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/lib/cdp-client.js#L235-L243
  await page.addInitScript({ content: HOOK_SCRIPT })
  await page.addInitScript({ content: SCRIPT })

  await page.goto(url)
  await page.waitForSelector("message-content", { timeout: 20000 })
  await page.waitForTimeout(3000)

  // In some shared conversations, title does not exists
  // page.evaluate: TypeError: Cannot read properties of null (reading 'textContent')
  const title = await page.evaluate(() => document.querySelector("h1 > strong")?.textContent ?? "")
  const includesKatex = await page.evaluate(() => document.getElementsByClassName("katex").length > 0)

  await page.evaluate(async () => {
    const dummyTagFunction: DummyTagFunction = (template, ...substitutions) =>
      // @ts-expect-error
      String.raw({ raw: template }, ...substitutions)
    const html = dummyTagFunction
    const css = dummyTagFunction

    // ----- Toggle buttons to expand truncated contents -----
    // Expand "Research Websites" section in Deep Research metadata
    document.querySelector<HTMLButtonElement>('[data-test-id="toggle-description-expansion-button"]')?.click()
    // Expand instructions text for the Gemini Gem used in the conversation
    document.querySelector<HTMLButtonElement>('[data-test-id="bot-instruction-see-more-button"]')?.click()

    // --- Prevent horizontal overflow on mobile devices ---
    const overflowStyles = new CSSStyleSheet()
    overflowStyles.replaceSync(css`
      .content-wrapper {
        max-width: 100vw;
      }

      /* Wrapper for tables */
      .horizontal-scroll-wrapper {
        margin-inline: 0 !important;
        padding-inline: 0 !important;
      }
    `)
    document.adoptedStyleSheets.push(overflowStyles)

    // ----- Remove unnecessary elements from the page -----
    // About Gemini section
    document.getElementsByTagName("top-bar-actions")[0]?.remove()
    // Sign-in buttons
    document.getElementsByClassName("boqOnegoogleliteOgbOneGoogleBar")[0]?.remove()
    document.getElementsByClassName("share-landing-page_footer")[0]?.remove()
    // Copy and flag buttons
    const linkActionButtons = document.getElementsByClassName("link-action-buttons")[0]?.children
    if (linkActionButtons) while (linkActionButtons.length > 0) linkActionButtons[0]!.remove()
    // Copy prompt buttons
    const copyPromptButtons = document.querySelectorAll('button[aria-label="Copy prompt"]')
    for (const copyPromptButton of copyPromptButtons) copyPromptButton.remove()
    // Sources buttons
    // They won't work anyways since we are removing all script tags
    const sourcesButtons = document.getElementsByTagName("sources-carousel-inline")
    while (sourcesButtons.length > 0) sourcesButtons[0]!.remove()
    // tts-control causes blank spaces at the end of some pages, while isn't displaying anything
    const ttsControls = document.getElementsByTagName("tts-control")
    while (ttsControls.length > 0) ttsControls[0]!.remove()
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

    // ----- Remove custom scrollbar -----
    function removeScrollbarRules(source: CSSStyleSheet | CSSMediaRule) {
      // Delete from the end of list to avoid index shift issues
      const reversedEntries = Array.from(source.cssRules).entries().toArray().reverse()
      for (const [index, rule] of reversedEntries) {
        if (rule instanceof CSSMediaRule) {
          removeScrollbarRules(rule)
        } else if (rule instanceof CSSStyleRule && rule.selectorText.includes("::-webkit-scrollbar")) {
          source.deleteRule(index)
        }
      }
    }
    for (const styleSheet of document.styleSheets) removeScrollbarRules(styleSheet)
    // Make the scrollbar span the entire window, not just the height of the .content-wrapper element
    const scrollbarStyles = new CSSStyleSheet()
    scrollbarStyles.replaceSync(css`
      html {
        overflow: unset;
      }

      body {
        height: unset !important;
      }

      /* ".desktop-ogb-buffer" couldn't be sticky,
       * if it had an ancestor element with overflow property set to something other than visible,
       * leaving no space space left for it to stick around
       * https://stackoverflow.com/a/66416972/ */
      chat-app,
      bard-sidenav-content {
        overflow: unset !important;
      }

      /* As a side effect of the header becoming sticky and having a background,
       * we must ensure the logo covers the header, not the reverse.
       * This overrides the default z-index at the "@media only screen and (max-width: 960px)" breakpoint. */
      .side-nav-menu-button {
        z-index: 3 !important;
      }

      /* Make the header truly sticky,
       * instead of having a header and a scrollable ".content-container" */
      .desktop-ogb-buffer {
        background: var(--bard-color-synthetic--chat-window-surface);
        padding-block: calc(6px + 12px) calc(6px + 10px) !important;
        margin-block: 0 !important;
        position: sticky;
        top: 0;
        z-index: 2;
      }

      .content-container {
        position: unset !important;
      }
    `)
    document.adoptedStyleSheets.push(scrollbarStyles)

    // ----- Replace bot instruction container with a <details> element -----
    // Wait for the full instruction text to load
    await new Promise(resolve => requestAnimationFrame(resolve))
    const botInstructionContainer = document.getElementsByClassName("bot-instruction-container")[0]
    if (botInstructionContainer) {
      const labelHTML = botInstructionContainer.querySelector<HTMLSpanElement>(".bot-instruction-label")!.outerHTML
      const contentHTML = botInstructionContainer.querySelector<HTMLPreElement>(".bot-instruction-content")!.outerHTML
      const matDividerHTML = botInstructionContainer.querySelector("mat-divider")!.outerHTML
      botInstructionContainer.innerHTML = html`
        <details>
          <summary>${labelHTML}</summary>
          ${contentHTML}
        </details>
        ${matDividerHTML}
      `
    }

    // ----- Replace font-based <mat-icon /> with their SVG equivalents to reduce bundle size -----
    // For example, expand button for chain of thought, Deep Research steps, etc.
    const matIcons = document.getElementsByTagName("mat-icon")
    while (matIcons.length > 0) {
      const matIcon = matIcons[0]!
      const iconComputedStyle = getComputedStyle(matIcon)
      const iconAttribute = matIcon.getAttribute("fonticon")

      const iconColor = iconComputedStyle.color
      const iconSize = parseInt(iconComputedStyle.fontSize)
      const iconName = iconAttribute == "drive_spreadsheet" ? "table" : iconAttribute
      // Find the "optical size" variant closest to the size of the original icon
      const replacementIconSize = [20, 24, 40, 48].reduce((accumulator, variant) =>
        Math.abs(variant - iconSize) < Math.abs(accumulator - iconSize) ? variant : accumulator
      )

      // https://stackoverflow.com/a/43916743/
      const newIconEl = document.createElement("div")
      newIconEl.style.backgroundColor = iconColor
      newIconEl.style.mask = `url(https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsrounded/${iconName}/default/${replacementIconSize}px.svg)`
      newIconEl.style.width = `${replacementIconSize}px`
      newIconEl.style.height = `${replacementIconSize}px`
      // Info icon for the "Uploaded file not shown" message
      if (iconSize != replacementIconSize) {
        newIconEl.style.transform = `scale(${iconSize / replacementIconSize})`
        newIconEl.style.transformOrigin = "top left"
      }

      matIcon.insertAdjacentElement("afterend", newIconEl)
      matIcon.remove()
    }
  })

  const getPageDataOptions = {
    // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/single-file-cli-api.js#L258
    // https://github.com/gildas-lormeau/single-file-cli/blob/v2.0.75/lib/cdp-client.js#L332
    // https://github.com/gildas-lormeau/single-file-core/blob/212a657/single-file.js#L125
    zipScript: ZIP_SCRIPT,
    // https://github.com/gildas-lormeau/SingleFile-MV3/blob/4903b74/src/core/bg/config.js#L45
    ...{ removeUnusedStyles: true, removeUnusedFonts: true, removeFrames: true, insertSingleFileComment: true }
  }
  const documentHTML = await page.evaluate(
    async options => singlefile.getPageData(options).then(({ content }) => content),
    getPageDataOptions
  )

  const variablesUsedInDocument = new Set(
    // Variable values could contain other values, so /var\(([^\)]+)/g won't work
    // e.g. --a: var(--b, var(--c));
    Array.from(documentHTML.matchAll(/var\s*\(\s*(?<variableName>--[A-Za-z0-9\-]+)/g)).map(
      regExpExecArray => regExpExecArray.groups!["variableName"]!
    )
  )

  const fileContent = documentHTML
    // Remove empty HTML comments
    .replaceAll("<!---->", "")
    // Remove unused CSS variable decelerations
    // <div style="--a: 0px"> ...
    .replaceAll(
      /(?<variableName>--[A-Za-z0-9\-]+)\s*:\s*(?<value>(?:(?!["']\s*>)[^;\n\}])+);?/gm,
      (_match, variableName: string, value: string) => {
        if (variablesUsedInDocument.has(variableName)) return `${variableName}:${value};`
        return ""
      }
    )
    // Remove base64 font declarations
    .replaceAll(/@font-face\s*{[^}]*}/g, (fontFaceRule: string) => {
      const fontFamilyMatch = fontFaceRule.match(/font-family\s*:\s*(?<quote>['"]?)(?<fontFamily>[^'",]+)\k<quote>/)
      const fontFamily = fontFamilyMatch?.groups!["fontFamily"]!.trim() ?? ""

      if (includesKatex && fontFamily.startsWith("KaTeX")) return fontFaceRule
      return ""
    })
    // Make the page print friendly
    .concat(html`
      <style>
        @media print {
          .side-nav-menu-button {
            position: unset !important;
            justify-content: start !important;
            margin-left: 0 !important;
          }

          .bard-logo-container {
            padding-left: 0 !important;
          }

          /* Remove buffer area for the (now static) header */
          .desktop-ogb-buffer {
            display: none !important;
          }

          .chat-history {
            padding-inline: 0 !important;
          }

          .avatar-gutter {
            display: none !important;
          }

          .markdown-main-panel {
            margin-right: 0 !important;
          }

          .share-viewer_legal-links {
            display: none !important;
          }
        }
      </style>
    `)

  // Remove illegal filename characters
  const sanitizedTitle = sanitize(title)
  // Fix ENAMETOOLONG error on Linux, where the maximum filename length is measured in bytes, not characters
  // https://stackoverflow.com/a/57769822/
  const truncatedTitle = new TextDecoder().decode(new TextEncoder().encode(sanitizedTitle).slice(0, 100))

  const fileName = `${id} - ${truncatedTitle}.html`
  const filePath = join(ARCHIVE_DIR, fileName)
  await writeFile(filePath, fileContent)
}

export function buildCommitMessage(added: string[], deleted: string[]): string {
  let message = "chore: automatic update of conversation archive\n"

  if (added.length > 0) message += `\nAdded conversations: ${added.join(", ")}`
  if (deleted.length > 0) message += `\nDeleted conversations: ${deleted.join(", ")}`

  return message
}
