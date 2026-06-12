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

Three large string constants defined at the top of the `<script>` block:

- `DIAGNOSTIC_PROMPT_TEMPLATE` — contact feasibility analysis (OS①)
- `PROMOTION_PROMPT_TEMPLATE` — escalation/reply analysis
- `FAILURE_PROMPT_TEMPLATE` — lost-sale deep analysis (失注分析OS)

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

## OS definition files

The `.md` files in the repo root are the "OS" (operating system / ruleset) documents that define how the AI should behave when given the diagnostic prompts:

- `OS① 接触可否・初回接触戦略分析OS Ver3.md` — contact feasibility OS (latest)
- `OS② 接触戦略・リアルタイム営業分析OS Ver3.md` — realtime sales analysis OS
- `失注分析OS v2.md` — lost-sale analysis OS

When updating prompt templates in `index.html`, sync the logic with the corresponding OS `.md` file.

## Key files

- `index.html` — the entire application (HTML + CSS + JS)
- `index_backup.html` — previous stable backup (do not edit)
- `index_old.html` — older version for reference
