<p align="center">
  <img src=".github/assets/readme-banner.png" alt="ParallaX — one brain, three dialects" width="880">
</p>

<p align="center">
  ParallaX is a repo-local, git-versioned <strong>project brain</strong> for handing context between AI tools.
</p>

<p align="center">
  <sub><code>MIT</code> · <code>Node ≥ 20</code> · <code>mock-first — runs with zero API keys</code></sub>
</p>

---

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
pnpm run dev -- init --provider openai-compatible --api-key
pnpm run dev -- init --provider claude --api-key
```

`--env` creates `.env` from `.env.example` only when it is absent.
`--api-key` requires an explicit live provider and never accepts the key on the
command line. It prompts securely, writes only `OPENAI_API_KEY`,
`GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`, and sets owner-only permissions where
supported. Existing shell environment variables always take precedence over
`.env`.

## Commands

```text
parallax init
parallax init --env
parallax init --provider openai --api-key
parallax init --provider gemini --api-key
parallax init --provider openai-compatible --api-key
parallax init --provider claude --api-key
parallax import <chat-export>
parallax import <chat-export> --provider openai
parallax import <chat-export> --provider gemini
parallax import <chat-export> --provider openai-compatible
parallax import <chat-export> --provider claude
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

The importer supports deterministic mock extraction, OpenAI Responses, Gemini
Interactions, OpenAI-compatible Chat Completions (custom `baseUrl` via local
preset only), and Claude Messages. Every provider is constrained by a portable
JSON Schema, validated again locally with Zod, and then checked against exact
transcript quotes. Mock extracts only explicit line-level markers:

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

### Provider capabilities

| Provider            | Protocol                     | Structured output                  | Storage          | Cost                                |
| ------------------- | ---------------------------- | ---------------------------------- | ---------------- | ----------------------------------- |
| `mock`              | Deterministic markers        | N/A (local)                        | N/A              | Always free                         |
| `openai`            | OpenAI Responses API         | Portable JSON Schema (`strict`)    | `store: false`   | Paid; not used in CI                |
| `gemini`            | Gemini Interactions API      | Portable JSON Schema subset        | `store: false`   | Free-tier may apply; not used in CI |
| `openai-compatible` | Chat Completions (`baseUrl`) | Portable JSON Schema (`strict`)    | Endpoint-defined | Endpoint-dependent; not used in CI  |
| `claude`            | Anthropic Messages API       | `output_config.format` JSON Schema | Provider-managed | Paid; not used in CI                |

The model-facing schema is a lowest-common-denominator JSON Schema: Gemini-
unsupported keywords such as `minLength` and `pattern` are stripped before the
request. `ImportDeltaSchema` remains the authoritative local validator, so empty
strings and invalid IDs/tags are still rejected after the provider responds.

Live provider failures are mapped to sanitized error categories without
attaching SDK causes, API keys, prompts, transcripts, or raw response bodies:

- `provider_auth`
- `provider_model_unavailable`
- `provider_rate_limit`
- `provider_refusal`
- `provider_malformed_output`
- `provider_unavailable`

An optional ignored preset can live at
`<store>/.local/providers.yaml`. It contains environment variable names, never
key values:

```yaml
provider: gemini
model: gemini-3.5-flash
apiKeyEnv: GEMINI_API_KEY
```

OpenAI-compatible endpoints require a YAML `baseUrl` (no CLI/env base URL in
V1) and an explicit model via the preset, `--model`, or `PARALLAX_MODEL`. The
endpoint receives the transcript and may retain it under its own policy; ParallaX
makes no retention guarantee for compatible providers:

```yaml
provider: openai-compatible
model: some-model
baseUrl: https://api.example.com/v1
apiKeyEnv: OPENAI_API_KEY
```

Configuration precedence is CLI, environment, local preset, then safe mock
defaults. ParallaX never infers a provider from whichever API key is present.
Selecting `mock` never loads OpenAI, Gemini, OpenAI-compatible, or Claude SDK
clients. `claude` and `openai-compatible` require an explicit model via the
preset, `--model`, or `PARALLAX_MODEL`.

### Gated Gemini live smoke

`pnpm test` and `pnpm run check` stay offline and never call live providers.
For one explicitly gated Gemini smoke request (preview + apply in a temporary
store):

```sh
PARALLAX_GEMINI_LIVE_SMOKE=1 GEMINI_API_KEY=... pnpm run smoke:gemini
```

Optional: `PARALLAX_MODEL=<model>` to control free-tier model availability.
The harness loads the repo `.env` without printing values, refuses to start
without both the gate flag and `GEMINI_API_KEY`, and is excluded from normal CI.

### Gated OpenAI-compatible live smoke

For one explicitly gated openai-compatible smoke (writes a temp
`.local/providers.yaml` with `baseUrl` + explicit model, then one import):

```sh
PARALLAX_COMPATIBLE_LIVE_SMOKE=1 \
  PARALLAX_COMPATIBLE_BASE_URL=https://api.example.com/v1 \
  PARALLAX_COMPATIBLE_MODEL=some-model \
  OPENAI_API_KEY=... \
  pnpm run smoke:compatible
```

Optional: `PARALLAX_COMPATIBLE_API_KEY_ENV` to select a non-default key variable.
`baseUrl` must be http(s) without embedded credentials. Transcript
retention/storage is endpoint-defined; ParallaX makes no retention guarantee.
Excluded from `pnpm test` and `pnpm run check`.

### Gated Claude live smoke

```sh
PARALLAX_CLAUDE_LIVE_SMOKE=1 ANTHROPIC_API_KEY=... PARALLAX_MODEL=claude-sonnet-4-5 \
  pnpm run smoke:claude
```

Uses one Messages request with portable JSON Schema via `output_config.format`.
Excluded from `pnpm test` and `pnpm run check`.

`compile` writes concise, approved context into safe managed blocks in
`AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/parallax.mdc`. It refuses malformed
or duplicated markers and preserves every byte outside the managed block.

`web` generates one self-contained `docs/index.html` that works from a local
file or on static hosting. `serve` starts a read-only MCP stdio server with
`get_context`, `search`, `get_decision`, and `list_tasks` tools.

## License

[MIT](LICENSE)
