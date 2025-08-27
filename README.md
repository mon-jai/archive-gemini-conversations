# Archive Gemini Conversations

`archive-gemini-conversations` is a GitHub composite action for archiving Google Gemini conversations. It scans Markdown
files for exported Gemini conversation URLs and saves them as standalone HTML files.

## Getting Started

1. Create `.github/workflows/archive-gemini-conversations.yml` in your repository with the following content:

   ```yaml
   name: Archive Gemini Conversations

   on:
     push:
     workflow_dispatch:

   concurrency:
     group: ${{ github.ref_name }}

   jobs:
     archive-gemini-conversations:
       runs-on: ubuntu-latest
       permissions:
         contents: write
       steps:
         - uses: mon-jai/archive-gemini-conversations@main
   ```

2. Add exported Gemini conversation URLs into any Markdown file in the repository.

   The URL should match one of the following patterns:
   - `https://g.co/gemini/share/*`
   - `https://gemini.google.com/share/*`

When you push changes to the default branch, the Action will:

- Scan all `.md` files for Gemini share URLs
- Archive new conversations as HTML files to the `<repo_root>/conversations/` directory
- Remove HTML files for conversations no longer present in any Markdown file

## How It Works

- Uses [Playwright](https://github.com/microsoft/playwright) to open Gemini share URL in a headless browser
- Cleans up the page (removing buttons, legal links, script tags, fonts, etc.)
- Saves the result as a static, self-contained HTML file with [SingleFile](https://github.com/gildas-lormeau/SingleFile)

## License

This project is licensed under [the MIT License](LICENSE).
