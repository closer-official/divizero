# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A single-file static web application for sales (営業) analysis. The tool lets users paste Twitter/X profile data, copy a structured prompt, run it in an external AI (e.g. Gemini, ChatGPT), paste the structured output back, and record/manage the results. **No API calls are made from the app itself** — all AI execution is done manually by the user in an external service.

## Running the app

Open `index.html` directly in a browser. No build step, no server, no dependencies to install. All CDN assets (Tailwind CSS, Font Awesome, Google Fonts) are loaded at runtime.

## Architecture

The entire application lives in a single file: `index.html`. It contains:

- **HTML structure** — four tab panels rendered at page load
- **Inline `<style>`** — custom scrollbar and tab fade-in animation
- **Inline `<script>`** — all application logic (~2000+ lines of vanilla JS)

### The four tabs

| Tab | ID | Purpose |
|---|---|---|
| 接触可否 | `tab-targets-panel` | Paste Twitter data → copy AI prompt → paste AI output → record targets in a scored list |
| 接触昇格判定 | `tab-replies-panel` | Analyse a reply to determine next contact step (リプ継続/DM移行/終了) |
| 失注原因ディープ分析 | `tab-failures-panel` | Deep-analyse a lost conversation log |
| 送信完了履歴 | `tab-logs-panel` | Log of all sent DM messages, exportable as TSV |

### Prompt templates

All prompt text lives in `/prompts/*.md` files. `index.html` fetches them at startup via `loadPrompts()` and assigns them to module-level `let` variables (`OS1_PROMPT`, `OS2_PROMPT`, etc.). **Never embed prompt text directly in `index.html`** — edit the corresponding `.md` file instead.

The app appends user-pasted raw data to these templates, then the user copies the combined prompt to run in an external AI. The AI must return output in a specific plain-text structured format (e.g. `【基本情報】`, `【営業分析】`, etc.) which the app then parses with regex.

### Data flow

1. User pastes raw text (Twitter profile / chat log) into a textarea
2. JS appends it to the relevant prompt template
3. User copies the assembled prompt and pastes it into an external AI
4. User pastes the AI's structured output back into the import textarea
5. JS parses the output using heading-based regex (e.g. `/【基本情報】([\s\S]*?)(?=【|$)/`)
6. Parsed data is stored in `localStorage` and rendered into tables/cards

### Persistence

All data (target list, send logs, per-target Gemini URLs, AI output history) is stored in browser `localStorage`. There is no backend.

## Prompt files (`/prompts/`)

Each file contains the exact text sent to the external AI. To update a prompt, edit only the corresponding file — `index.html` loads them at runtime via `fetch()`.

| File | Variable | Role |
|---|---|---|
| `OS1_X_接触スクリーニング_latest.md` | `OS1_PROMPT` | X（Twitter）接触スクリーニングOS① |
| `OS1_Threads_接触スクリーニング_latest.md` | `OS1_THREADS_PROMPT` | Threads 接触スクリーニングOS① |
| `OS1_Instagram_接触スクリーニング_latest.md` | `OS1_INSTAGRAM_PROMPT` | Instagram 接触スクリーニングOS① |
| `OS2_行動判定_latest.md` | `OS2_PROMPT` | 行動判定OS②（接触昇格判定タブ） |
| `OS3_案件検証_latest.md` | `OS3_PROMPT` | 案件検証OS③（失注分析タブ） |
| `IG読み取りOCR_latest.md` | `IG_READ_PROMPT` | Instagram スクショOCR読み取り補助 |

**Naming convention**: `{OS番号}_{対象SNS}_{役割}_latest.md` — `latest` は常に現行版であることを示す。バージョンを上げるときはファイル名を変えず内容を上書きする。

## Key files

- `index.html` — the entire application (HTML + CSS + JS)
- `index_backup.html` — previous stable backup (do not edit)
- `index_old.html` — older version for reference
