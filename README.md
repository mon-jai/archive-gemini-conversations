# Archive Gemini Conversations

`archive-gemini-conversations` is a GitHub composite action for archiving Google Gemini conversations. It scans Markdown
files for shared Gemini conversation URLs and saves them as standalone HTML files.

## Getting Started

1. Create a workflow file at `.github/workflows/archive-gemini-conversations.yml` in a repository with the following
   content:

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

2. Add publicly shared Gemini conversation URLs to any Markdown file within the repository. The URL must match one of
   the following patterns:
   - `https://g.co/gemini/share/*`
   - `https://gemini.google.com/share/*`

When changes are pushed to the default branch, the Action scans all `.md` files, archives new conversations as HTML
files to the `<repo_root>/conversations/` directory, and deletes archives for URLs that are no longer present.

## How It Works

- Uses [Playwright](https://github.com/microsoft/playwright) to open the conversation in a headless browser
- Cleans up the page (removing buttons, legal links, script tags, fonts, etc.)
- Saves the result as a static, self-contained HTML file with [SingleFile](https://github.com/gildas-lormeau/SingleFile)

## License

This project is licensed under [the MIT License](LICENSE).
