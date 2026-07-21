# ParallaX Demo Runbook

This runbook prepares a deterministic ParallaX walkthrough without live
provider calls, API keys, or changes to the tracked synthetic store. It defines
the visual sequence and expected product state, not the final voiceover.

## Preflight

Use Node.js 24.x and pnpm 11.15.0. From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run demo:check
pnpm run check
```

Run `demo:check` before `demo:build`. The check creates a fresh temporary build
and compares it with the tracked artifacts, so it exposes stale output rather
than silently repairing it.

The read-only public explorer is available at
<https://omen-mali.github.io/ParallaX/>. The tracked page is
`demo/site/index.html`; `docs/index.html` is reserved for snapshots generated
by normal `parallax web` use.

## Prepare an isolated recording store

Never apply recording imports to `demo/store`. Create the ignored store used by
the interactive recording:

```sh
pnpm run dev init --store .parallax-demo
pnpm run dev ui --store .parallax-demo --mock
```

To reset after a take, close the local UI, preserve the prior store under an
unused backup name, then initialize a clean one:

```sh
mv .parallax-demo .parallax-demo.previous
pnpm run dev init --store .parallax-demo
pnpm run dev ui --store .parallax-demo --mock
```

If `.parallax-demo.previous` already exists, choose another backup name instead
of overwriting it. On Windows, rename the folder through File Explorer before
repeating the two `pnpm` commands.

## Three-tool scenario

The sanitized recording inputs are:

1. `demo/recording/codex.md`
2. `demo/recording/claude.md`
3. `demo/recording/gemini.md`

Use the local UI's file input with the generic Markdown format. All proposal
checkboxes begin unchecked.

1. Preview the Codex input, select `d1` and `t1`, confirm two items, and apply.
2. Preview the Claude input, select `d1` and `q1`, enable metadata-only
   retention, confirm two items, and apply.
3. Preview the Gemini input, select `g1` and `s1`, confirm two items, and apply.
4. Refresh the snapshot and show two decisions, one task, one question, one
   glossary term, one spec change, three sources, one metadata-only notice, and
   exact evidence.
5. Compile the approved context to the desired agent instruction targets.

The scenario tells one handoff story: Codex establishes the repo-local project
brain, Claude adds the source-retention boundary, and Gemini defines provenance
and the compiled agent handoff.

## Sub-three-minute visual sequence

| Time      | Visual beat                                     | Expected result                                      |
| --------- | ----------------------------------------------- | ---------------------------------------------------- |
| 0:00-0:12 | Codex, Claude, and Gemini conversation montage  | Project knowledge is visibly scattered               |
| 0:12-0:28 | ParallaX architecture and local UI launch       | One approved repo-local store is introduced          |
| 0:28-1:15 | Codex preview, evidence, selection, and apply   | Only selected verified records are written           |
| 1:15-1:42 | Claude and Gemini import montage                | Privacy, question, glossary, and spec records appear |
| 1:42-2:08 | Snapshot, provenance, and metadata-only example | Trust and retention boundaries are visible           |
| 2:08-2:30 | Compile and reopen tool-specific context        | Another agent can continue from approved context     |
| 2:30-2:47 | Tests, CI, and public explorer                  | Implementation quality and testability are shown     |
| 2:47-2:57 | ParallaX mark and public demo URL               | The walkthrough ends below three minutes             |

## Recording hygiene

- Use `--mock` for every recorded import and keep network-dependent clips
  separate from the primary walkthrough.
- Use only the sanitized files under `demo/recording/`; do not show private
  chats, shell history, environment files, or local provider presets.
- Hide notifications and browser bookmarks, and verify that no API key or
  session capability is visible in the capture.
- Record each tool window independently at the same 16:9 resolution, then
  compose the brief split frame during editing.
- Capture successful operations as separate clips. The final sequence need not
  be one continuous live take.
- Keep `demo/store` read-only and confirm `git status` after recording.

## Generated-artifact recovery

If `pnpm run demo:check` reports drift after an intentional generator or style
change:

1. Run `pnpm run demo:build`.
2. Review changes under `demo/store/` and `demo/site/index.html`.
3. Run `pnpm run demo:check` again.
4. Run the complete `pnpm run check` suite before staging.

Do not run the build first merely to make CI pass. Checking first preserves the
drift signal and makes unintended generated changes reviewable.
