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
human-editable project brain to Git. Mock is the safe default and requires no
API key. For live imports, add a local `.env` (gitignored) from the tracked
template, or select a provider and prompt for its key on a TTY:

```sh
pnpm run dev -- init --env
pnpm run dev -- init --provider openai --api-key
pnpm run dev -- init --provider gemini --api-key
```

`--env` creates `.env` from `.env.example` only when it is absent.
`--api-key` requires an explicit live provider and never accepts the key on the
command line. It prompts securely, writes only `OPENAI_API_KEY` or
`GEMINI_API_KEY`, and sets owner-only permissions where supported.
Existing shell environment variables always take precedence over `.env`.

## Commands

```text
parallax init
parallax init --env
parallax init --provider openai --api-key
parallax init --provider gemini --api-key
parallax import <chat-export>
parallax import <chat-export> --provider openai
parallax import <chat-export> --provider gemini
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

The importer supports deterministic mock extraction, OpenAI Responses, and
Gemini Interactions. Every provider is constrained by a portable JSON Schema,
validated again locally with Zod, and then checked against exact transcript
quotes. Mock extracts only explicit line-level markers:

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

For a live import, set the matching key and select the provider explicitly:

```sh
pnpm run dev -- import chat.md --provider openai
pnpm run dev -- import chat.md --provider gemini
```

Use `--model <name>` or `PARALLAX_MODEL` to override the provider default.
`PARALLAX_PROVIDER` can select a provider without a CLI flag. Mock remains the
only guaranteed zero-cost path; no live provider is assumed to be free.

An optional ignored preset can live at
`<store>/.local/providers.yaml`. It contains environment variable names, never
key values:

```yaml
provider: gemini
model: gemini-3.5-flash
apiKeyEnv: GEMINI_API_KEY
```

Configuration precedence is CLI, environment, local preset, then safe mock
defaults. ParallaX never infers a provider from whichever API key is present.

`compile` writes concise, approved context into safe managed blocks in
`AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/parallax.mdc`. It refuses malformed
or duplicated markers and preserves every byte outside the managed block.

`web` generates one self-contained `docs/index.html` that works from a local
file or on static hosting. `serve` starts a read-only MCP stdio server with
`get_context`, `search`, `get_decision`, and `list_tasks` tools.

## License

[MIT](LICENSE)
