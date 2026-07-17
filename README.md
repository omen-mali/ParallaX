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

## Development

Requires Node.js 20 or later.

```sh
pnpm install
pnpm run check
pnpm run dev -- --help
```

## Planned commands

```text
parallax init
parallax import <chat-export>
parallax compile
parallax serve
parallax web
```

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

For a live import, set `OPENAI_API_KEY` in your environment and run
`pnpm run dev -- import chat.md`. API keys are never written, displayed, or
stored by ParallaX. Use `--model <name>` to override the default model.

`compile` writes concise, approved context into safe managed blocks in
`AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/parallax.mdc`. It refuses malformed
or duplicated markers and preserves every byte outside the managed block.

`web` generates one self-contained `docs/index.html` that works from a local
file or on static hosting. `serve` starts a read-only MCP stdio server with
`get_context`, `search`, `get_decision`, and `list_tasks` tools.

## License

[MIT](LICENSE)
