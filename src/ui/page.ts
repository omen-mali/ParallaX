/**
 * The local UI deliberately ships as one dependency-free HTML document. The
 * document contains no store data or session secret; the loopback server
 * injects the nonce and supplies all data through authenticated JSON APIs.
 */

export const UI_SESSION_HEADER = "X-Parallax-Session";

export const UI_API_PATHS = {
  snapshot: "/api/snapshot",
  config: "/api/config",
  inspectImport: "/api/imports/inspect",
  previewImport: "/api/imports/preview",
  applyProposal: (proposalId: string): string =>
    `/api/proposals/${encodeURIComponent(proposalId)}/apply`,
  compile: "/api/compile",
} as const;

export interface UiPageOptions {
  /** A server-generated CSP nonce for the page's inline style and script. */
  nonce: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Render the unprivileged browser shell for `parallax ui`.
 *
 * Imported and store-derived values never enter this template. The embedded
 * script creates their nodes with textContent after fetching authenticated API
 * responses, which keeps untrusted transcript content out of HTML parsing.
 */
export function renderUiHtml({ nonce }: UiPageOptions): string {
  const escapedNonce = escapeAttribute(nonce);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>ParallaX local UI</title>
    <style nonce="${escapedNonce}">
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, system-ui, sans-serif;
        --bg: #0a0a0a;
        --fg: #f4f4f5;
        --muted: #a1a1aa;
        --faint: #71717a;
        --panel: #111111;
        --inset: #0e0e10;
        --line: #27272a;
        --accent: #a78bfa;
        --accent-strong: #8b5cf6;
        --live: #34d399;
        --live-chip-bg: rgba(52, 211, 153, 0.1);
        --live-chip-line: rgba(52, 211, 153, 0.25);
        --chip: rgba(255, 255, 255, 0.05);
        --chip-accent: rgba(139, 92, 246, 0.13);
        --chip-accent-line: rgba(167, 139, 250, 0.35);
        --chip-accent-fg: #c4b5fd;
        --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
        --ease: cubic-bezier(0.4, 0, 0.2, 1);
        --accent-text: #ffffff;
        --btn-primary-bg: #f4f4f5;
        --btn-primary-fg: #0a0a0a;
        --danger: #fca5a5;
        --danger-line: rgba(252, 165, 165, 0.4);
        --focus: rgba(139, 92, 246, 0.55);
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #fafafa;
          --fg: #0a0a0a;
          --muted: #52525b;
          --faint: #71717a;
          --panel: #ffffff;
          --inset: #fafafa;
          --line: #e4e4e7;
          --accent: #7c3aed;
          --accent-strong: #6d28d9;
          --live: #059669;
          --live-chip-bg: rgba(5, 150, 105, 0.08);
          --live-chip-line: rgba(5, 150, 105, 0.3);
          --chip: #f4f4f5;
          --chip-accent: rgba(124, 58, 237, 0.08);
          --chip-accent-line: rgba(124, 58, 237, 0.25);
          --chip-accent-fg: #6d28d9;
          --btn-primary-bg: #18181b;
          --btn-primary-fg: #fafafa;
          --danger: #b42318;
          --danger-line: rgba(180, 35, 24, 0.35);
          --focus: rgba(124, 58, 237, 0.35);
        }
      }
      * { box-sizing: border-box; }
      body { max-width: 72rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--fg); }
      h1 { margin: 0; font-size: 1.7rem; letter-spacing: -0.02em; }
      h2 { margin: 0; font-size: 1.15rem; }
      h3 { margin: 0; font-size: 1rem; }
      p { line-height: 1.5; }
      a { color: var(--accent); }
      a:hover { color: var(--accent-strong); }
      .kicker { margin: 0 0 0.25rem; font-family: var(--mono); font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.22em; color: var(--accent); }
      .brand-header { display: flex; align-items: flex-start; gap: 1rem; }
      .brand-mark { flex: none; margin-top: 0.15rem; }
      .brand-x { color: var(--accent); }
      button, input, select, textarea { font: inherit; }
      button, select, input, textarea { border: 1px solid var(--line); border-radius: 0.5rem; background: var(--panel); color: var(--fg); }
      button { cursor: pointer; padding: 0.55rem 0.8rem; transition: border-color 0.2s var(--ease), background-color 0.2s var(--ease), opacity 0.2s var(--ease); }
      button:hover:not(:disabled) { border-color: var(--accent); background: var(--chip); }
      button:disabled { cursor: not-allowed; opacity: 0.62; }
      button.primary { border-color: var(--btn-primary-bg); background: var(--btn-primary-bg); color: var(--btn-primary-fg); font-weight: 650; }
      button.primary:hover:not(:disabled) { border-color: var(--btn-primary-bg); background: var(--btn-primary-bg); opacity: 0.9; }
      button.primary:active:not(:disabled) { transform: scale(0.98); }
      button.danger { border-color: var(--danger-line); color: var(--danger); }
      button.danger:hover:not(:disabled) { border-color: var(--danger); background: var(--chip); }
      input, select, textarea { width: 100%; padding: 0.55rem 0.6rem; background: var(--inset); }
      textarea { min-height: 12rem; resize: vertical; font-family: var(--mono); font-size: 0.85rem; }
      input[type="checkbox"], input[type="radio"] { width: auto; accent-color: var(--accent-strong); }
      input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
      header { margin-bottom: 1.5rem; }
      .lede, .muted, .field-note { color: var(--muted); }
      .lede { max-width: 50rem; margin: 0.35rem 0 0; }
      .notice { margin: 1rem 0; padding: 0.75rem 0.9rem; border: 1px solid var(--line); border-radius: 0.5rem; background: var(--panel); line-height: 1.45; }
      .notice.error { border-color: var(--danger-line); color: var(--danger); }
      .layout { display: grid; gap: 1.25rem; }
      .panel { padding: 1.1rem 1.2rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--panel); animation: rise 0.5s var(--ease) backwards; }
      .layout > .panel:nth-child(2) { animation-delay: 0.06s; }
      .layout > .panel:nth-child(3) { animation-delay: 0.12s; }
      .layout > .panel:nth-child(4) { animation-delay: 0.18s; }
      .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.8rem; }
      .panel-header p { margin: 0.35rem 0 0; }
      .panel-header .kicker { margin: 0 0 0.2rem; }
      .fields { display: grid; gap: 0.85rem; }
      .two-column { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
      label.field { display: grid; gap: 0.35rem; font-size: 0.9rem; }
      fieldset { min-width: 0; margin: 0; padding: 0.8rem; border: 1px solid var(--line); border-radius: 0.5rem; }
      legend { padding: 0 0.3rem; font-weight: 600; }
      .inline-options { display: flex; flex-wrap: wrap; gap: 0.55rem 1rem; }
      .inline-options label, .checkbox-row { display: inline-flex; align-items: center; gap: 0.4rem; }
      .import-form { max-width: 64rem; margin: 0 auto; gap: 1.1rem; }
      .import-input { display: grid; gap: 1rem; padding: 1rem; }
      .input-mode-options { width: min(100%, 34rem); justify-content: center; margin: 0 auto; }
      .input-mode-options label {
        flex: 1 1 13rem;
        justify-content: center;
        min-height: 2.7rem;
        padding: 0.45rem 0.7rem;
        border: 1px solid var(--line);
        border-radius: 0.5rem;
        background: var(--inset);
        transition: border-color 0.2s var(--ease), background-color 0.2s var(--ease);
      }
      .input-mode-options label:hover { border-color: var(--accent); }
      .input-mode-options label:has(input:checked) { border-color: var(--chip-accent-line); background: var(--chip-accent); }
      .import-source { width: min(100%, 58rem); margin: 0 auto; }
      .import-source .field-note { text-align: center; }
      .import-settings {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1rem;
        align-items: start;
        padding: 1rem;
        border: 1px solid var(--line);
        border-radius: 0.5rem;
        background: var(--inset);
      }
      .import-settings .field { min-width: 0; }
      .import-settings .field-note { min-height: 2.7em; text-align: center; }
      .import-actions { justify-content: center; text-align: center; }
      .actions { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
      .actions.spaced { margin-top: 0.8rem; }
      .field.grow { flex: 1 1 16rem; }
      .hidden { display: none !important; }
      .snapshot-groups { display: grid; gap: 1rem; }
      .record-group { display: grid; gap: 0.65rem; }
      .record-group h3 { margin-top: 0.35rem; }
      .cards { display: grid; gap: 0.65rem; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
      article.card { padding: 0.8rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--inset); overflow-wrap: anywhere; transition: border-color 0.2s var(--ease); }
      article.card:hover { border-color: var(--chip-accent-line); }
      .card-meta, .provenance, .empty { color: var(--muted); font-size: 0.85rem; }
      .card-body { margin: 0.5rem 0 0; white-space: pre-wrap; }
      .status { display: inline-flex; align-items: center; gap: 0.32rem; margin-left: 0.35rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: var(--chip); border: 1px solid var(--line); color: var(--muted); font-family: var(--mono); font-size: 0.72rem; }
      .status::before { content: ""; width: 0.32rem; height: 0.32rem; border-radius: 50%; background: var(--faint); }
      .status[data-status="active"], .status[data-status="open"] { background: var(--live-chip-bg); border-color: var(--live-chip-line); color: var(--live); }
      .status[data-status="active"]::before, .status[data-status="open"]::before { background: var(--live); }
      details { margin-top: 0.65rem; }
      summary { cursor: pointer; color: var(--accent); }
      dl { display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: 0.35rem 0.65rem; margin: 0.65rem 0 0; font-size: 0.88rem; }
      dt { color: var(--faint); }
      dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
      .evidence { margin-top: 0.7rem; padding: 0.65rem; border-left: 3px solid var(--accent-strong); background: var(--panel); border-radius: 0 0.35rem 0.35rem 0; }
      .evidence blockquote { margin: 0.35rem 0 0; white-space: pre-wrap; }
      .proposal-list { display: grid; gap: 0.65rem; margin-top: 0.8rem; }
      .proposal-item { display: grid; gap: 0.2rem; padding: 0.7rem; border: 1px solid var(--line); border-radius: 0.5rem; background: var(--inset); transition: border-color 0.2s var(--ease), background-color 0.2s var(--ease); }
      .proposal-item:has(input:checked) { border-color: var(--chip-accent-line); background: var(--chip-accent); }
      .proposal-choice { display: flex; align-items: start; gap: 0.5rem; font-weight: 600; }
      .proposal-key { display: inline-block; min-width: 2.2rem; color: var(--accent); font-family: var(--mono); }
      .proposal-evidence { margin: 0.25rem 0 0 1.75rem; color: var(--muted); white-space: pre-wrap; }
      .proposal-summary { margin: 0.5rem 0; white-space: pre-wrap; }
      pre.result { max-height: 16rem; overflow: auto; padding: 0.75rem; border: 1px solid var(--line); border-radius: 0.5rem; background: var(--inset); white-space: pre-wrap; font-family: var(--mono); font-size: 0.85rem; }
      dialog { max-width: min(32rem, calc(100vw - 2rem)); border: 1px solid var(--line); border-radius: 0.75rem; color: var(--fg); background: var(--panel); box-shadow: 0 1rem 4rem rgb(0 0 0 / 50%); }
      dialog::backdrop { background: rgb(0 0 0 / 60%); }
      dialog form { display: grid; gap: 0.9rem; }
      .dialog-actions { display: flex; justify-content: end; gap: 0.6rem; }
      .cards .empty { position: relative; padding: 1rem 5rem 1rem 1rem; background: var(--inset); border: 1px dashed var(--line); border-radius: 0.6rem; }
      .cards .empty::after { content: ""; position: absolute; right: 0.8rem; top: 50%; width: 2.8rem; height: 2.5rem; transform: translateY(-50%) skewX(-10deg); opacity: 0.14; background: linear-gradient(#4f46e5, #4f46e5) right top / 58% 22% no-repeat, linear-gradient(#7c3aed, #7c3aed) left 55% center / 68% 22% no-repeat, linear-gradient(#8b5cf6, #8b5cf6) left bottom / 78% 22% no-repeat; }
      @media (prefers-color-scheme: light) { .cards .empty::after { opacity: 0.1; } }
      @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition: none !important; }
      }
      @media (max-width: 56rem) {
        .import-settings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .import-settings > :last-child { grid-column: 1 / -1; width: calc((100% - 1rem) / 2); justify-self: center; }
      }
      @media (max-width: 42rem) {
        body { padding: 1.2rem 0.85rem 3rem; }
        .panel-header { align-items: start; flex-direction: column; }
        .brand-header { gap: 0.75rem; }
        .input-mode-options { justify-content: stretch; }
        .input-mode-options label { flex-basis: 100%; }
        .import-settings { grid-template-columns: 1fr; }
        .import-settings > :last-child { grid-column: auto; width: auto; justify-self: stretch; }
      }
    </style>
  </head>
  <body>
    <header class="brand-header">
      <svg class="brand-mark" width="44" height="44" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect x="2" y="2" width="60" height="60" rx="14" fill="#111111" stroke="#27272a" stroke-width="2"></rect>
        <path d="M16 23 L26 32 L16 41" fill="none" stroke="#34d399" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M35 26 L41 32" fill="none" stroke="#b6a0fc" stroke-width="5" stroke-linecap="round"></path>
        <path d="M47 26 L41 32" fill="none" stroke="#8b5cf6" stroke-width="5" stroke-linecap="round"></path>
        <path d="M47 38 L41 32" fill="none" stroke="#6366f1" stroke-width="5" stroke-linecap="round"></path>
        <path d="M35 38 L41 32" fill="none" stroke="#7c3aed" stroke-width="5" stroke-linecap="round"></path>
        <circle cx="41" cy="32" r="6.2" fill="#8b5cf6" opacity="0.16"></circle>
        <circle cx="41" cy="32" r="4.6" fill="#4c1d95"></circle>
        <path d="M41 28.8 L42 31 L44.2 32 L42 33 L41 35.2 L40 33 L37.8 32 L40 31 Z" fill="#ede9fe"></path>
        <rect x="35" y="44" width="12" height="4" rx="2" fill="#a78bfa"></rect>
      </svg>
      <div>
        <p class="kicker">Local UI · Loopback-only</p>
        <h1>Paralla<span class="brand-x">X</span></h1>
        <p class="lede">A local, loopback-only view of the approved project brain. Imports are previewed and verified before explicitly applying selected items.</p>
      </div>
    </header>

    <p id="notice" class="notice hidden" role="status" aria-live="polite"></p>

    <main class="layout">
      <section class="panel" aria-labelledby="snapshot-title">
        <div class="panel-header">
          <div>
            <p class="kicker">Store</p>
            <h2 id="snapshot-title">Approved snapshot.</h2>
            <p class="muted">Reads directly from the local approved store.</p>
          </div>
          <button id="refresh-snapshot" type="button">Refresh</button>
        </div>
        <div id="snapshot" class="snapshot-groups" aria-live="polite"></div>
      </section>

      <section class="panel" aria-labelledby="import-title">
        <div class="panel-header">
          <div>
            <p class="kicker">Import</p>
            <h2 id="import-title">Preview an import.</h2>
            <p class="muted">Content remains in this browser until you request a preview. The server keeps the verified proposal only in memory.</p>
          </div>
        </div>

        <div class="fields import-form">
          <fieldset class="import-input">
            <legend>Input</legend>
            <div class="inline-options input-mode-options">
              <label><input name="input-mode" type="radio" value="paste" checked /> Paste text</label>
              <label><input name="input-mode" type="radio" value="file" /> Choose a file</label>
            </div>
            <label id="paste-field" class="field import-source">
              Transcript or export text
              <textarea id="paste-contents" spellcheck="false" placeholder="Paste a generic Markdown transcript or ChatGPT export here."></textarea>
            </label>
            <label id="file-field" class="field import-source hidden">
              Export file
              <input id="source-file" type="file" />
              <span class="field-note">The browser reads file contents with File.text(). Its local path is never sent.</span>
            </label>
          </fieldset>

          <div class="import-settings">
            <label class="field">
              Import format
              <select id="import-format">
                <option value="generic">Generic Markdown</option>
                <option value="chatgpt">ChatGPT export</option>
              </select>
            </label>
            <label class="field">
              Provider
              <select id="provider" aria-describedby="provider-note"></select>
              <span id="provider-note" class="field-note">Provider configuration and API keys stay on the local server.</span>
            </label>
            <label class="field">
              Model
              <input id="model" type="text" autocomplete="off" placeholder="Use configured default" />
            </label>
          </div>

          <fieldset id="conversation-field" class="hidden">
            <legend>ChatGPT conversation</legend>
            <p class="field-note">Inspect the export, then select exactly one conversation for the preview.</p>
            <div class="actions">
              <button id="inspect-chatgpt" type="button">Inspect ChatGPT export</button>
              <label class="field grow">
                Conversation
                <select id="conversation" disabled>
                  <option value="">Inspect an export first</option>
                </select>
              </label>
            </div>
          </fieldset>

          <div class="actions import-actions">
            <button id="preview-import" class="primary" type="button">Preview verified proposal</button>
            <span class="field-note">Maximum request size: 25 MiB.</span>
          </div>
        </div>
      </section>

      <section id="proposal-panel" class="panel hidden" aria-labelledby="proposal-title">
        <div class="panel-header">
          <div>
            <p class="kicker">Proposal</p>
            <h2 id="proposal-title">Verified proposal.</h2>
            <p id="proposal-summary" class="proposal-summary"></p>
          </div>
        </div>
        <p id="proposal-empty" class="empty hidden">No items were extracted. Nothing can be applied.</p>
        <div id="proposal-items" class="proposal-list"></div>
        <div class="actions spaced">
          <button id="apply-selected" class="primary" type="button" disabled>Apply 0 selected items</button>
        </div>
      </section>

      <section class="panel" aria-labelledby="compile-title">
        <div class="panel-header">
          <div>
            <p class="kicker">Compile</p>
            <h2 id="compile-title">Compile context.</h2>
            <p class="muted">Only approved store content is compiled into selected local targets.</p>
          </div>
        </div>
        <fieldset>
          <legend>Targets</legend>
          <div class="inline-options">
            <label><input name="compile-target" type="checkbox" value="agents" checked /> AGENTS.md</label>
            <label><input name="compile-target" type="checkbox" value="claude" checked /> CLAUDE.md</label>
            <label><input name="compile-target" type="checkbox" value="cursor" checked /> Cursor rules</label>
          </div>
        </fieldset>
        <div class="actions spaced">
          <button id="compile-context" type="button">Compile selected targets</button>
        </div>
        <pre id="compile-result" class="result hidden" aria-live="polite"></pre>
      </section>
    </main>

    <dialog id="apply-dialog" aria-labelledby="apply-dialog-title">
      <form method="dialog">
        <h2 id="apply-dialog-title">Apply selected items?</h2>
        <p id="apply-confirmation"></p>
        <label class="checkbox-row"><input id="metadata-only" type="checkbox" /> Keep this import metadata-only</label>
        <p class="field-note">This writes only the selected items from the current verified proposal. The proposal cannot be reused after applying.</p>
        <div class="dialog-actions">
          <button id="cancel-apply" value="cancel" type="submit">Cancel</button>
          <button id="confirm-apply" class="primary" value="confirm" type="button">Apply selected items</button>
        </div>
      </form>
    </dialog>

    <script nonce="${escapedNonce}">
      "use strict";

      const session = new URLSearchParams(window.location.hash.slice(1)).get("session");

      const sessionHeader = "${UI_SESSION_HEADER}";
      const maxRequestBytes = 25 * 1024 * 1024;
      const byId = (id) => document.getElementById(id);
      const notice = byId("notice");
      const snapshotRoot = byId("snapshot");
      const refreshButton = byId("refresh-snapshot");
      const pasteField = byId("paste-field");
      const fileField = byId("file-field");
      const pasteContents = byId("paste-contents");
      const sourceFile = byId("source-file");
      const formatSelect = byId("import-format");
      const providerSelect = byId("provider");
      const providerNote = byId("provider-note");
      const modelInput = byId("model");
      const conversationField = byId("conversation-field");
      const inspectButton = byId("inspect-chatgpt");
      const conversationSelect = byId("conversation");
      const previewButton = byId("preview-import");
      const proposalPanel = byId("proposal-panel");
      const proposalSummary = byId("proposal-summary");
      const proposalEmpty = byId("proposal-empty");
      const proposalItems = byId("proposal-items");
      const metadataOnly = byId("metadata-only");
      const applySelected = byId("apply-selected");
      const applyDialog = byId("apply-dialog");
      const applyConfirmation = byId("apply-confirmation");
      const cancelApply = byId("cancel-apply");
      const confirmApply = byId("confirm-apply");
      const compileButton = byId("compile-context");
      const compileResult = byId("compile-result");

      let inputMode = "paste";
      let inspectedContents = null;
      let preparedProposal = null;
      const providerDefaultModels = {
        mock: "mock",
        openai: "gpt-5.6",
        gemini: "gemini-3.5-flash",
      };

      function record(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
      }

      function stringValue(value) {
        return typeof value === "string" ? value : "";
      }

      function arrayValue(value) {
        return Array.isArray(value) ? value : [];
      }

      function clear(node) {
        while (node.firstChild) {
          node.removeChild(node.firstChild);
        }
      }

      function element(name, className) {
        const node = document.createElement(name);
        if (className) node.className = className;
        return node;
      }

      function textNode(value) {
        return document.createTextNode(value == null ? "" : String(value));
      }

      function showNotice(message, error) {
        notice.textContent = message;
        notice.classList.remove("hidden");
        notice.classList.toggle("error", Boolean(error));
      }

      function clearNotice() {
        notice.textContent = "";
        notice.classList.add("hidden");
        notice.classList.remove("error");
      }

      function errorText(payload, fallback) {
        const body = record(payload);
        const message = stringValue(body.error) || stringValue(body.message);
        return message || fallback;
      }

      async function request(path, init) {
        if (!session) {
          throw new Error("The local UI session is missing. Relaunch parallax ui.");
        }
        const options = init || {};
        const headers = new Headers(options.headers || {});
        headers.set(sessionHeader, session);
        const response = await fetch(path, {
          method: options.method || "GET",
          headers,
          body: options.body,
          credentials: "omit",
          cache: "no-store",
          mode: "same-origin",
        });
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? await response.json().catch(() => ({}))
          : {};
        if (!response.ok) {
          throw new Error(errorText(payload, "The local UI request failed."));
        }
        return payload;
      }

      function postJson(path, body) {
        const serialized = JSON.stringify(body);
        if (new Blob([serialized]).size > maxRequestBytes) {
          return Promise.reject(new Error("The request exceeds the 25 MiB limit."));
        }
        return request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized,
        });
      }

      function detailRow(list, label, value) {
        if (value === undefined || value === null || value === "") return;
        const term = element("dt");
        term.textContent = label;
        const detail = element("dd");
        detail.textContent = String(value);
        list.append(term, detail);
      }

      function provenance(evidence, sources) {
        const proof = record(evidence);
        const wrap = element("div", "evidence");
        const heading = element("strong");
        heading.textContent = "Evidence";
        wrap.append(heading);

        const quote = stringValue(proof.quote);
        if (quote) {
          const blockquote = element("blockquote");
          blockquote.textContent = quote;
          wrap.append(blockquote);
        }

        const sourceId = stringValue(proof.sourceId);
        const provenanceLine = element("p", "provenance");
        const pieces = [];
        if (sourceId) pieces.push("Source " + sourceId);
        if (Number.isInteger(proof.turnIndex)) pieces.push("turn " + proof.turnIndex);
        if (stringValue(proof.role)) pieces.push("role " + proof.role);
        if (Number.isInteger(proof.startChar) && Number.isInteger(proof.endChar)) {
          pieces.push("span " + proof.startChar + "–" + proof.endChar);
        }
        if (stringValue(proof.quoteHash)) pieces.push("quote hash " + proof.quoteHash);
        if (pieces.length > 0) {
          provenanceLine.textContent = pieces.join(" · ");
          wrap.append(provenanceLine);
        } else if (quote) {
          provenanceLine.textContent = "Stored evidence quote only (no source provenance on this record).";
          wrap.append(provenanceLine);
        }

        const source = sourceId ? sources.get(sourceId) : undefined;
        if (source && source.metadataOnly === true) {
          const metadataNotice = element("p", "provenance");
          metadataNotice.textContent = "Transcript retention was disabled for this metadata-only source.";
          wrap.append(metadataNotice);
        }
        return wrap;
      }

      function card(kind, item, sources) {
        const value = record(item);
        const article = element("article", "card");
        const title = element("h3");
        const name =
          stringValue(value.title) ||
          stringValue(value.question) ||
          stringValue(value.term) ||
          stringValue(value.section) ||
          stringValue(value.id) ||
          kind;
        title.textContent = name;

        const meta = element("p", "card-meta");
        meta.append(textNode(kind));
        const status = stringValue(value.status);
        if (status) {
          const chip = element("span", "status");
          chip.textContent = status;
          chip.dataset.status = status;
          meta.append(chip);
        }

        const body =
          stringValue(value.decision) ||
          stringValue(value.detail) ||
          stringValue(value.question) ||
          stringValue(value.definition) ||
          stringValue(value.content) ||
          "";
        const bodyNode = element("p", "card-body");
        bodyNode.textContent = body;
        article.append(title, meta, bodyNode);

        const details = element("details");
        const summary = element("summary");
        summary.textContent = "Details and provenance";
        const list = element("dl");
        detailRow(list, "ID", stringValue(value.id));
        detailRow(list, "Created", stringValue(value.createdAt));
        detailRow(list, "Updated", stringValue(value.updatedAt));
        detailRow(list, "Context", stringValue(value.context));
        detailRow(list, "Rationale", stringValue(value.rationale));
        detailRow(list, "Alternatives", arrayValue(value.alternatives).filter((entry) => typeof entry === "string").join("; "));
        detailRow(list, "Tags", arrayValue(value.tags).filter((entry) => typeof entry === "string").map((entry) => "#" + entry).join(" "));
        detailRow(list, "Supersedes", stringValue(value.supersedes));
        detailRow(list, "Operation", stringValue(value.operation));
        details.append(summary, list, provenance(value.evidence, sources));
        article.append(details);
        return article;
      }

      function sourceCard(item) {
        const source = record(item);
        const article = element("article", "card");
        const title = element("h3");
        title.textContent = stringValue(source.title) || stringValue(source.id) || "Source";
        const meta = element("p", "card-meta");
        meta.textContent = "source";
        if (source.metadataOnly === true) {
          const chip = element("span", "status");
          chip.textContent = "metadata-only";
          meta.append(chip);
        }
        const details = element("dl");
        detailRow(details, "ID", stringValue(source.id));
        detailRow(details, "Imported", stringValue(source.importedAt));
        article.append(title, meta, details);
        if (source.metadataOnly === true) {
          const note = element("p", "provenance");
          note.textContent = "Transcript retention was disabled for this source.";
          article.append(note);
        }
        return article;
      }

      function appendGroup(root, headingText, kind, records, sources, isSource) {
        const group = element("section", "record-group");
        const heading = element("h3");
        heading.textContent = headingText;
        const cards = element("div", "cards");
        const entries = arrayValue(records);
        if (entries.length === 0) {
          const empty = element("p", "empty");
          empty.textContent = "No " + headingText.toLowerCase() + " recorded.";
          cards.append(empty);
        } else {
          for (const entry of entries) {
            cards.append(isSource ? sourceCard(entry) : card(kind, entry, sources));
          }
        }
        group.append(heading, cards);
        root.append(group);
      }

      function renderSnapshot(snapshotPayload) {
        const snapshot = record(snapshotPayload);
        const sources = new Map();
        for (const source of arrayValue(snapshot.sources)) {
          const sourceRecord = record(source);
          const sourceId = stringValue(sourceRecord.id);
          if (sourceId) sources.set(sourceId, sourceRecord);
        }
        clear(snapshotRoot);
        appendGroup(snapshotRoot, "Decisions", "decision", snapshot.decisions, sources, false);
        appendGroup(snapshotRoot, "Tasks", "task", snapshot.tasks, sources, false);
        appendGroup(snapshotRoot, "Questions", "question", snapshot.questions, sources, false);
        appendGroup(snapshotRoot, "Glossary", "glossary", snapshot.glossary, sources, false);
        appendGroup(snapshotRoot, "Spec changes", "spec change", snapshot.specChanges, sources, false);
        appendGroup(snapshotRoot, "Sources", "source", snapshot.sources, sources, true);
      }

      async function refreshSnapshot() {
        refreshButton.disabled = true;
        try {
          const payload = record(await request("${UI_API_PATHS.snapshot}"));
          renderSnapshot(payload.snapshot);
          clearNotice();
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Unable to refresh the local store.", true);
        } finally {
          refreshButton.disabled = false;
        }
      }

      function addOption(select, value, label) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
      }

      async function loadConfig() {
        try {
          const config = record(await request("${UI_API_PATHS.config}"));
          const providers = arrayValue(config.providers).filter((provider) => typeof provider === "string");
          const mockLocked = config.mockLocked === true;
          clear(providerSelect);
          const selectableProviders = mockLocked ? ["mock"] : providers;
          if (selectableProviders.length === 0) {
            addOption(providerSelect, "", "Configured default");
          } else {
            for (const provider of selectableProviders) addOption(providerSelect, provider, provider);
          }
          const configuredProvider = mockLocked ? "mock" : stringValue(config.provider);
          if (configuredProvider && Array.from(providerSelect.options).some((option) => option.value === configuredProvider)) {
            providerSelect.value = configuredProvider;
          }
          providerSelect.disabled = mockLocked;
          modelInput.disabled = mockLocked;
          modelInput.value = mockLocked ? "mock" : stringValue(config.model);
          providerNote.textContent = mockLocked
            ? "Mock mode is locked for this launch and makes no provider network calls."
            : "Provider configuration and API keys stay on the local server.";
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Unable to load provider configuration.", true);
        }
      }

      function updateProviderModel() {
        const selected = providerSelect.value;
        if (Object.prototype.hasOwnProperty.call(providerDefaultModels, selected)) {
          modelInput.value = providerDefaultModels[selected];
          return;
        }
        if (modelInput.value === "mock" || modelInput.value === "gpt-5.6" || modelInput.value === "gemini-3.5-flash") {
          modelInput.value = "";
        }
      }

      function setInputMode(nextMode) {
        inputMode = nextMode;
        pasteField.classList.toggle("hidden", nextMode !== "paste");
        fileField.classList.toggle("hidden", nextMode !== "file");
        inspectedContents = null;
        resetConversation();
      }

      function resetConversation() {
        clear(conversationSelect);
        addOption(conversationSelect, "", "Inspect an export first");
        conversationSelect.disabled = true;
      }

      function updateFormat() {
        const isChatGpt = formatSelect.value === "chatgpt";
        conversationField.classList.toggle("hidden", !isChatGpt);
        if (!isChatGpt) {
          inspectedContents = null;
          resetConversation();
        }
      }

      async function inputPayload() {
        if (inputMode === "file") {
          const file = sourceFile.files && sourceFile.files[0];
          if (!file) throw new Error("Choose an export file first.");
          if (file.size > maxRequestBytes) throw new Error("The request exceeds the 25 MiB limit.");
          const contents = await file.text();
          return { contents, fileName: file.name };
        }
        const contents = pasteContents.value;
        if (!contents.trim()) throw new Error("Paste export content first.");
        if (new Blob([contents]).size > maxRequestBytes) throw new Error("The request exceeds the 25 MiB limit.");
        return { contents, fileName: undefined };
      }

      async function inspectChatGpt() {
        inspectButton.disabled = true;
        try {
          const input = await inputPayload();
          const payload = record(await postJson("${UI_API_PATHS.inspectImport}", input));
          const conversations = arrayValue(payload.conversations);
          clear(conversationSelect);
          addOption(conversationSelect, "", "Choose a conversation");
          for (const entry of conversations) {
            const conversation = record(entry);
            const id = stringValue(conversation.id);
            if (!id) continue;
            const title = stringValue(conversation.title) || "Untitled conversation";
            const turns = Number.isInteger(conversation.turnCount) ? " (" + conversation.turnCount + " turns)" : "";
            addOption(conversationSelect, id, title + turns);
          }
          conversationSelect.disabled = false;
          inspectedContents = input.contents;
          showNotice(conversations.length === 0 ? "No conversations were found in this export." : "Select a conversation, then preview the verified proposal.", false);
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Unable to inspect the ChatGPT export.", true);
        } finally {
          inspectButton.disabled = false;
        }
      }

      function proposalEntries(proposal) {
        const value = record(proposal);
        const explicit = arrayValue(value.items);
        if (explicit.length > 0) {
          return explicit.map((entry) => {
            const item = record(entry);
            return {
              key: stringValue(item.key),
              type: stringValue(item.kind) || stringValue(item.type) || "item",
              label: stringValue(item.label) || stringValue(item.title) || stringValue(item.question) || stringValue(item.term) || stringValue(item.section) || "Untitled item",
              evidenceQuote: stringValue(item.evidenceQuote) || stringValue(record(item.evidence).quote),
            };
          }).filter((item) => item.key);
        }
        const groups = [
          ["decisions", "d", "Decision", "title"],
          ["tasks", "t", "Task", "title"],
          ["questions", "q", "Question", "question"],
          ["glossary", "g", "Glossary", "term"],
          ["specChanges", "s", "Spec change", "section"],
        ];
        const entries = [];
        for (const group of groups) {
          const items = arrayValue(value[group[0]]);
          for (let index = 0; index < items.length; index += 1) {
            const item = record(items[index]);
            entries.push({
              key: group[1] + String(index + 1),
              type: group[2],
              label: stringValue(item[group[3]]) || "Untitled item",
              evidenceQuote: stringValue(record(item.evidence).quote),
            });
          }
        }
        return entries;
      }

      function selectedKeys() {
        if (!preparedProposal) return [];
        const known = new Set(preparedProposal.items.map((item) => item.key));
        return Array.from(proposalItems.querySelectorAll("input[type=checkbox]:checked"))
          .map((input) => input.value)
          .filter((key) => known.has(key));
      }

      function updateApplyButton() {
        const count = selectedKeys().length;
        applySelected.textContent = "Apply " + count + " selected " + (count === 1 ? "item" : "items");
        applySelected.disabled = count === 0 || !preparedProposal;
      }

      function clearProposal() {
        preparedProposal = null;
        metadataOnly.checked = false;
        clear(proposalItems);
        proposalSummary.textContent = "";
        proposalEmpty.classList.add("hidden");
        proposalPanel.classList.add("hidden");
        updateApplyButton();
      }

      function renderProposal(payload) {
        const result = record(payload);
        const proposal = record(result.proposal);
        const proposalId = stringValue(proposal.id) || stringValue(result.proposalId);
        if (!proposalId) throw new Error("The server did not return a valid proposal.");
        const items = proposalEntries(proposal);
        preparedProposal = { id: proposalId, items };
        clear(proposalItems);
        proposalSummary.textContent = stringValue(proposal.summary);
        proposalEmpty.classList.toggle("hidden", items.length !== 0);
        for (const item of items) {
          const row = element("label", "proposal-item");
          const choice = element("span", "proposal-choice");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = item.key;
          checkbox.addEventListener("change", updateApplyButton);
          const key = element("span", "proposal-key");
          key.textContent = item.key;
          const label = element("span");
          label.textContent = item.type + ": " + item.label;
          choice.append(checkbox, key, label);
          row.append(choice);
          if (item.evidenceQuote) {
            const evidence = element("p", "proposal-evidence");
            evidence.textContent = "Evidence: “" + item.evidenceQuote + "”";
            row.append(evidence);
          }
          proposalItems.append(row);
        }
        proposalPanel.classList.remove("hidden");
        updateApplyButton();
      }

      async function previewImport() {
        // The server also invalidates first, but immediately disarming the
        // client prevents an older proposal from being applied while a new
        // preview request is still uploading.
        clearProposal();
        previewButton.disabled = true;
        try {
          const input = await inputPayload();
          const format = formatSelect.value;
          let conversationId;
          if (format === "chatgpt") {
            if (input.contents !== inspectedContents) {
              throw new Error("Inspect this ChatGPT export before previewing a conversation.");
            }
            conversationId = conversationSelect.value;
            if (!conversationId) throw new Error("Select a ChatGPT conversation first.");
          }
          const payload = await postJson("${UI_API_PATHS.previewImport}", {
            format,
            contents: input.contents,
            fileName: input.fileName,
            conversationId,
            provider: providerSelect.value || undefined,
            model: modelInput.value.trim() || undefined,
          });
          renderProposal(payload);
          clearNotice();
        } catch (error) {
          clearProposal();
          showNotice(error instanceof Error ? error.message : "Unable to preview the import.", true);
        } finally {
          previewButton.disabled = false;
        }
      }

      function updateApplyConfirmation() {
        const selected = selectedKeys();
        const retention = metadataOnly.checked
          ? "This import will be metadata-only; transcript text will not be retained."
          : "This import will retain the normalized transcript under the approved local store.";
        applyConfirmation.textContent = "Apply " + selected.length + " selected " + (selected.length === 1 ? "item" : "items") + "? " + retention;
      }

      function openApplyDialog() {
        const selected = selectedKeys();
        if (selected.length === 0) {
          showNotice("Select at least one verified proposal item before applying.", true);
          return;
        }
        updateApplyConfirmation();
        if (typeof applyDialog.showModal === "function") {
          applyDialog.showModal();
        } else {
          applyDialog.setAttribute("open", "");
        }
      }

      function closeApplyDialog() {
        if (typeof applyDialog.close === "function") {
          applyDialog.close();
        } else {
          applyDialog.removeAttribute("open");
        }
      }

      async function applyProposal() {
        if (!preparedProposal) {
          showNotice("This proposal is no longer available. Preview the import again.", true);
          closeApplyDialog();
          return;
        }
        const selected = selectedKeys();
        if (selected.length === 0) {
          showNotice("Select at least one verified proposal item before applying.", true);
          closeApplyDialog();
          return;
        }
        confirmApply.disabled = true;
        try {
          const response = record(await postJson("/api/proposals/" + encodeURIComponent(preparedProposal.id) + "/apply", {
            selectedKeys: selected,
            metadataOnly: metadataOnly.checked,
            confirmed: true,
          }));
          const appliedCount = Number.isInteger(response.appliedCount) ? response.appliedCount : selected.length;
          clearProposal();
          closeApplyDialog();
          if (response.snapshot) {
            renderSnapshot(response.snapshot);
          } else {
            await refreshSnapshot();
          }
          showNotice("Applied " + appliedCount + " selected " + (appliedCount === 1 ? "item" : "items") + ".", false);
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Unable to apply the proposal.", true);
        } finally {
          confirmApply.disabled = false;
        }
      }

      async function compileContext() {
        const targets = Array.from(document.querySelectorAll("input[name=compile-target]:checked")).map((input) => input.value);
        if (targets.length === 0) {
          showNotice("Select at least one compile target.", true);
          return;
        }
        compileButton.disabled = true;
        try {
          const payload = record(await postJson("${UI_API_PATHS.compile}", { targets }));
          const compiled = arrayValue(payload.compiled);
          const lines = compiled.length === 0
            ? ["No target files were compiled."]
            : compiled.map((entry) => {
                const result = record(entry);
                return stringValue(result.path) || stringValue(result.target) || JSON.stringify(result);
              });
          compileResult.textContent = lines.join("\\n");
          compileResult.classList.remove("hidden");
          clearNotice();
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Unable to compile context.", true);
        } finally {
          compileButton.disabled = false;
        }
      }

      for (const input of document.querySelectorAll("input[name=input-mode]")) {
        input.addEventListener("change", () => setInputMode(input.value));
      }
      sourceFile.addEventListener("change", () => {
        inspectedContents = null;
        resetConversation();
      });
      pasteContents.addEventListener("input", () => {
        inspectedContents = null;
        resetConversation();
      });
      formatSelect.addEventListener("change", updateFormat);
      providerSelect.addEventListener("change", updateProviderModel);
      inspectButton.addEventListener("click", inspectChatGpt);
      previewButton.addEventListener("click", previewImport);
      applySelected.addEventListener("click", openApplyDialog);
      cancelApply.addEventListener("click", closeApplyDialog);
      confirmApply.addEventListener("click", applyProposal);
      metadataOnly.addEventListener("change", () => {
        if (applyDialog.open) updateApplyConfirmation();
      });
      compileButton.addEventListener("click", compileContext);
      refreshButton.addEventListener("click", refreshSnapshot);

      updateFormat();
      if (!session) {
        showNotice("The local UI session is missing. Close this tab and relaunch parallax ui.", true);
      } else {
        Promise.all([loadConfig(), refreshSnapshot()]);
      }
    </script>
  </body>
</html>
`;
}
