# Claude Handoff Overview

This repo is the operating system for a manual sales workflow:
paste SNS profile or conversation text, generate a prompt, run an external AI, paste the result back, and store the outcome.

Scope for this handoff:
- Focus on the sales OS, not `Tab6` / SNS人格OS Ver.4.
- Keep the prompt-driven, human-in-the-loop workflow in view.
- Treat the app as a coordinator, not an AI executor.

What matters most:
- `src/types.ts` defines the domain model.
- `src/App.tsx` wires the tabs, startup checks, and cross-tab handoff.
- `src/utils/parser.ts` defines the output formats the app expects back from Claude/Gemini/etc.
- The prompt files under `public/prompts/` are the real operational spec.

What to ignore for this pass:
- `Tab6`
- Any long-term redesign outside the existing OS flow
- Feature expansion beyond the current sales workflow

Recommended reading order:
1. `CLAUDE.md`
2. `docs/01_handoff_flow_and_scope.md`
3. `src/types.ts`
4. `src/App.tsx`
5. `src/utils/parser.ts`
6. The OS prompt files listed in the file pack

