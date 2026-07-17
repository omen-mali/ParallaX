# ParallaX

ParallaX is a repo-local, git-versioned project brain for handing context
between AI tools.

Its V1 loop is:

```text
chat export -> validated proposal -> explicit apply -> .parallax -> compile
```

Every applied item carries verified, exact evidence from its source chat. The
approved `.parallax/` store is human-editable, git-diffable, and the single
source of truth.

## Status

The project foundation and validation contract are in place. The upcoming
milestones add the validated import pipeline, compiler, static timeline, and
MCP read tools.

## Setup

Requires Node.js 20 or later.

```sh
pnpm install
pnpm run check
pnpm run dev -- init
```

`init` creates the durable `.parallax/` store. Commit this plain-file,
human-editable project brain to Git. For live imports, add a local `.env`
(gitignored) from the tracked template, or prompt for a key on a TTY:

```sh
pnpm run dev -- init --env
pnpm run dev -- init --api-key
```

`--env` creates `.env` from `.env.example` only when it is absent.
`--api-key` never accepts the key on the command line; it prompts securely,
writes `OPENAI_API_KEY`, and sets owner-only permissions where supported.
Existing shell environment variables always take precedence over `.env`.
Mock mode needs no key.

## Commands

```text
parallax init
parallax init --env
parallax init --api-key
parallax import <chat-export>
parallax compile
parallax serve
parallax web
```

Every store-facing command accepts `--store <path>`. Paths are relative to the
project root (`--root`) and must remain inside it. The default is `.parallax`.
Use an ignored alternate store for demos or exploratory imports:

```sh
parallax init --store .parallax.local
PARALLAX_MOCK=1 parallax import chat.md --apply --store .parallax.local
```

`.parallax/.local/`, `.parallax.local/`, and `.parallax-demo/` are local-only
and ignored. The canonical `.parallax/` store—including `sources/`—is tracked
so evidence remains independently verifiable. Imports retain their normalized
source transcript by default. For sensitive material, use `--metadata-only` to
store source metadata without transcript text, or use an ignored local store.
ParallaX never silently changes the retention choice.

The live importer uses GPT-5.6 through the Responses API and validates its
structured proposal with Zod. A deterministic mock mode extracts only explicit,
line-level markers and therefore needs no API key:

```md
## User

Decision: Use a plain-file store
Task: Add evidence validation
Question: Should MCP write data?
Term: provenance - exact supporting chat text
```

```sh
pnpm run dev -- init
PARALLAX_MOCK=1 pnpm run dev -- import chat.md
PARALLAX_MOCK=1 pnpm run dev -- import chat.md --apply
```

For a live import, ensure `OPENAI_API_KEY` is set (via the environment or
`.env`) and run `pnpm run dev -- import chat.md`. Use `--model <name>` or
`PARALLAX_MODEL` to override the default model.

`compile` writes concise, approved context into safe managed blocks in
`AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/parallax.mdc`. It refuses malformed
or duplicated markers and preserves every byte outside the managed block.

`web` generates one self-contained `docs/index.html` that works from a local
file or on static hosting. `serve` starts a read-only MCP stdio server with
`get_context`, `search`, `get_decision`, and `list_tasks` tools.

## License

[MIT](LICENSE)
