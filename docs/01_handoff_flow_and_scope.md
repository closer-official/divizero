# Handoff Flow and Scope

## User flow

1. `Tab0`
   - Paste search timeline / follower list text, or profile screenshots.
   - Copy the OS0 prompt.
   - Run an external AI.
   - Paste the AI output back.
   - Save pass/fail results into the data store.

2. `Tab1`
   - Paste OS1 output.
   - Parse the `【見出し】` blocks.
   - Save `Target` records and move selected items into the pipeline.

3. `Tab2`
   - Manage active deals.
   - Record touches, reactions, conversation turns, OS2 judgments, DM judgments, and close events.
   - This is the operational center of the app.

4. `Tab3`
   - Analyze closed deals.
   - Receive a prefilled case from `Tab2`.
   - Paste OS3 output and store the result.

5. `Tab4` and `Tab5`
   - Aggregation and analysis history.
   - Useful, but secondary to the operational flow above.

## Data and persistence

- Primary storage is Firestore.
- Fallback storage is `localStorage`.
- The whole app state is stored as one JSON payload in `workspace/main`.

## Important scope notes

- `Tab6` is excluded from this handoff.
- The prompt files are part of the system contract, not just content.
- Parser expectations are strict; the AI output format matters as much as the UI.

## Why this pack is limited

This repo contains many legacy and adjacent systems. For a clean handoff, keep the package focused on:
- core sales OS flow
- state model
- persistence
- prompt contracts
- parser contract

