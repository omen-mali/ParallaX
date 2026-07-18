import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readStore, type StoreSnapshot } from "../store/read.js";

export interface WebPagePayload extends StoreSnapshot {
  generatedAt: string;
}

function serializedData(payload: WebPagePayload): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function renderTimelineHtml(
  snapshot: StoreSnapshot,
  options: { generatedAt?: string } = {},
): string {
  const payload: WebPagePayload = {
    ...snapshot,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
  const data = serializedData(payload);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ParallaX Project Brain</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, system-ui, sans-serif;
        --bg: #f4f6f8;
        --fg: #172033;
        --muted: #526078;
        --panel: #ffffff;
        --line: #d7dee8;
        --accent: #0f766e;
        --chip: #e8eef5;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #101726;
          --fg: #e2e8f0;
          --muted: #aab8d0;
          --panel: #182238;
          --line: #2a3850;
          --accent: #2dd4bf;
          --chip: #243247;
        }
      }
      body { max-width: 56rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--fg); }
      h1 { margin: 0 0 0.35rem; font-size: 1.85rem; }
      h2 { margin: 0 0 0.75rem; font-size: 1.2rem; }
      h3 { margin: 0 0 0.35rem; font-size: 1.05rem; }
      p, .lede { color: var(--muted); line-height: 1.5; }
      header { margin-bottom: 1.5rem; }
      .meta { font-size: 0.9rem; color: var(--muted); }
      .counts { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1.25rem 0; }
      .count { background: var(--panel); border: 1px solid var(--line); border-radius: 0.4rem; padding: 0.55rem 0.75rem; font-size: 0.9rem; }
      .count strong { display: block; font-size: 1.15rem; color: var(--fg); }
      .controls { display: grid; gap: 0.75rem; margin: 1rem 0 1.75rem; padding: 1rem; background: var(--panel); border: 1px solid var(--line); border-radius: 0.5rem; }
      .controls label { display: grid; gap: 0.35rem; font-size: 0.85rem; color: var(--muted); }
      .controls input, .controls select { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 0.35rem; padding: 0.45rem 0.55rem; }
      .filter-row { display: flex; flex-wrap: wrap; gap: 0.75rem; }
      .filter-row label { flex: 1 1 10rem; }
      section.block { margin: 2rem 0; }
      .timeline { border-left: 2px solid var(--accent); margin: 1rem 0 0; padding-left: 1.35rem; }
      article.record { position: relative; margin: 0 0 1rem; padding: 0.9rem 1rem; background: var(--panel); border: 1px solid var(--line); border-radius: 0.5rem; }
      .timeline article.record::before { content: ""; position: absolute; width: 0.65rem; height: 0.65rem; left: -1.75rem; top: 1.2rem; border-radius: 50%; background: var(--accent); }
      .record-meta, .tags, .empty { font-size: 0.85rem; color: var(--muted); }
      .tags { display: inline; margin-left: 0.35rem; }
      .chip { display: inline-block; background: var(--chip); border-radius: 0.25rem; padding: 0.1rem 0.4rem; margin: 0.1rem 0.2rem 0.1rem 0; font-size: 0.8rem; }
      details.record-details { margin-top: 0.65rem; }
      details.record-details summary { cursor: pointer; color: var(--accent); font-size: 0.9rem; }
      .detail-grid { display: grid; gap: 0.35rem; margin-top: 0.65rem; font-size: 0.9rem; }
      .detail-grid dt { color: var(--muted); font-size: 0.8rem; }
      .detail-grid dd { margin: 0 0 0.4rem; }
      .evidence { margin-top: 0.5rem; padding: 0.65rem 0.75rem; border-left: 3px solid var(--accent); background: var(--bg); }
      .evidence-label { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.25rem; }
      .provenance-note { font-size: 0.85rem; color: var(--muted); margin-top: 0.35rem; }
      .hidden { display: none !important; }
      .list { display: grid; gap: 0.75rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>ParallaX</h1>
      <p class="lede">Read-only explorer for the approved project brain. Generated from the selected store; nothing on this page edits the store.</p>
      <p class="meta">Generated at <time id="generated-at"></time></p>
    </header>
    <div id="counts" class="counts" aria-live="polite"></div>
    <div class="controls" id="controls">
      <label>Search
        <input id="search" type="search" placeholder="Filter by keyword" autocomplete="off" />
      </label>
      <div class="filter-row">
        <label>Record type
          <select id="type-filter">
            <option value="all">All types</option>
            <option value="decision">Decisions</option>
            <option value="task">Tasks</option>
            <option value="question">Questions</option>
            <option value="glossary">Glossary</option>
            <option value="spec">Spec changes</option>
          </select>
        </label>
        <label>Status
          <select id="status-filter">
            <option value="all">All statuses</option>
            <option value="active">Active / open</option>
            <option value="done">Done / resolved / superseded</option>
          </select>
        </label>
        <label>Tag
          <select id="tag-filter">
            <option value="all">All tags</option>
          </select>
        </label>
      </div>
    </div>
    <main id="app"></main>
    <script>
      const snapshot = ${data};
      const app = document.querySelector("#app");
      const counts = document.querySelector("#counts");
      const generatedAt = document.querySelector("#generated-at");
      const searchInput = document.querySelector("#search");
      const typeFilter = document.querySelector("#type-filter");
      const statusFilter = document.querySelector("#status-filter");
      const tagFilter = document.querySelector("#tag-filter");
      const sourcesById = new Map((snapshot.sources || []).map((source) => [source.id, source]));

      generatedAt.dateTime = snapshot.generatedAt;
      generatedAt.textContent = new Date(snapshot.generatedAt).toLocaleString();

      function text(value) {
        return value == null ? "" : String(value);
      }

      function matchesKeyword(haystack, query) {
        if (!query) return true;
        return haystack.toLowerCase().includes(query);
      }

      function statusBucket(status) {
        if (status === "active" || status === "open") return "active";
        if (status === "done" || status === "resolved" || status === "superseded") return "done";
        return "other";
      }

      function appendCount(label, value) {
        const item = document.createElement("div");
        item.className = "count";
        const strong = document.createElement("strong");
        strong.textContent = String(value);
        item.append(strong, document.createTextNode(label));
        counts.append(item);
      }

      const decisions = snapshot.decisions || [];
      const tasks = snapshot.tasks || [];
      const activeDecisions = decisions.filter((decision) => decision.status === "active");
      const openTasks = tasks.filter((task) => task.status === "open");
      const openQuestions = (snapshot.questions || []).filter((q) => q.status === "open");
      appendCount("Active decisions", activeDecisions.length);
      appendCount("Open tasks", openTasks.length);
      appendCount("Open questions", openQuestions.length);
      appendCount("Glossary terms", (snapshot.glossary || []).length);
      appendCount("Spec changes", (snapshot.specChanges || []).length);

      const allTags = [...new Set(
        (snapshot.decisions || []).flatMap((decision) => decision.tags || [])
      )].sort();
      for (const tag of allTags) {
        const option = document.createElement("option");
        option.value = tag;
        option.textContent = "#" + tag;
        tagFilter.append(option);
      }

      function emptyState(message) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = message;
        return p;
      }

      function evidenceBlock(evidence) {
        const wrap = document.createElement("div");
        wrap.className = "evidence";
        const label = document.createElement("div");
        label.className = "evidence-label";
        label.textContent = "Evidence";
        const quote = document.createElement("blockquote");
        quote.textContent = evidence && evidence.quote ? evidence.quote : "";
        wrap.append(label, quote);

        if (evidence && evidence.sourceId) {
          const meta = document.createElement("div");
          meta.className = "provenance-note";
          const parts = ["Source " + evidence.sourceId];
          if (typeof evidence.turnIndex === "number") {
            parts.push("turn " + evidence.turnIndex);
          }
          meta.textContent = parts.join(" · ");
          wrap.append(meta);

          const source = sourcesById.get(evidence.sourceId);
          if (source && source.metadataOnly) {
            const note = document.createElement("div");
            note.className = "provenance-note";
            note.textContent = "Transcript retention was disabled.";
            wrap.append(note);
          }
        } else if (evidence && evidence.quote) {
          const note = document.createElement("div");
          note.className = "provenance-note";
          note.textContent = "Stored evidence quote only (no source id on this record).";
          wrap.append(note);
        }
        return wrap;
      }

      function detailItem(term, value) {
        const dt = document.createElement("dt");
        dt.textContent = term;
        const dd = document.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
      }

      function detailsPanel(entries, evidence) {
        const details = document.createElement("details");
        details.className = "record-details";
        const summary = document.createElement("summary");
        summary.textContent = "Record details";
        const grid = document.createElement("dl");
        grid.className = "detail-grid";
        for (const [term, value] of entries) {
          if (value == null || value === "") continue;
          grid.append(...detailItem(term, value));
        }
        details.append(summary, grid, evidenceBlock(evidence));
        return details;
      }

      function createRecord(options) {
        const article = document.createElement("article");
        article.className = "record";
        article.dataset.type = options.type;
        article.dataset.status = statusBucket(options.status);
        article.dataset.tags = (options.tags || []).join(" ");
        article.dataset.search = options.searchText.toLowerCase();

        const title = document.createElement("h3");
        title.textContent = options.title;
        const meta = document.createElement("div");
        meta.className = "record-meta";
        meta.textContent = options.metaLine;
        if (options.tags && options.tags.length > 0) {
          const tags = document.createElement("span");
          tags.className = "tags";
          for (const tag of options.tags) {
            const chip = document.createElement("span");
            chip.className = "chip";
            chip.textContent = "#" + tag;
            tags.append(chip);
          }
          meta.append(tags);
        }
        const body = document.createElement("p");
        body.textContent = options.body;
        article.append(title, meta, body, detailsPanel(options.detailEntries, options.evidence));
        return article;
      }

      function section(id, type, titleText) {
        const block = document.createElement("section");
        block.className = "block";
        block.id = id;
        block.dataset.type = type;
        const heading = document.createElement("h2");
        heading.textContent = titleText;
        block.append(heading);
        return block;
      }

      const decisionsSection = section("decisions", "decision", "Decisions");
      const timeline = document.createElement("div");
      timeline.className = "timeline";
      if (decisions.length === 0) {
        timeline.append(emptyState("No approved decisions yet."));
      } else {
        for (const decision of decisions) {
          timeline.append(
            createRecord({
              type: "decision",
              status: decision.status,
              tags: decision.tags || [],
              title: decision.title,
              metaLine: new Date(decision.createdAt).toLocaleString() + " · " + decision.status,
              body: decision.decision,
              searchText: [decision.title, decision.decision, decision.context, decision.rationale, (decision.tags || []).join(" "), decision.evidence && decision.evidence.quote]
                .map(text).join(" "),
              detailEntries: [
                ["ID", decision.id],
                ["Status", decision.status],
                ["Created", decision.createdAt],
                ["Updated", decision.updatedAt],
                ["Context", decision.context],
                ["Rationale", decision.rationale],
                ["Alternatives", (decision.alternatives || []).join("; ")],
                ["Supersedes", decision.supersedes],
                ["Source ID", decision.evidence && decision.evidence.sourceId],
                ["Turn index", decision.evidence && typeof decision.evidence.turnIndex === "number" ? String(decision.evidence.turnIndex) : ""],
              ],
              evidence: decision.evidence,
            }),
          );
        }
      }
      decisionsSection.append(timeline);

      const tasksSection = section("tasks", "task", "Tasks");
      const taskList = document.createElement("div");
      taskList.className = "list";
      if (tasks.length === 0) {
        taskList.append(emptyState("No tasks recorded."));
      } else {
        for (const task of tasks) {
          taskList.append(
            createRecord({
              type: "task",
              status: task.status,
              tags: [],
              title: task.title,
              metaLine: task.status + (task.createdAt ? " · " + new Date(task.createdAt).toLocaleString() : ""),
              body: task.detail || task.title,
              searchText: [task.title, task.detail, task.evidence && task.evidence.quote].map(text).join(" "),
              detailEntries: [
                ["ID", task.id],
                ["Status", task.status],
                ["Created", task.createdAt],
                ["Source ID", task.evidence && task.evidence.sourceId],
                ["Turn index", task.evidence && typeof task.evidence.turnIndex === "number" ? String(task.evidence.turnIndex) : ""],
              ],
              evidence: task.evidence,
            }),
          );
        }
      }
      tasksSection.append(taskList);

      const questionsSection = section("questions", "question", "Questions");
      const questionList = document.createElement("div");
      questionList.className = "list";
      const questions = snapshot.questions || [];
      if (questions.length === 0) {
        questionList.append(emptyState("No questions recorded."));
      } else {
        for (const question of questions) {
          questionList.append(
            createRecord({
              type: "question",
              status: question.status,
              tags: [],
              title: question.question,
              metaLine: question.status,
              body: question.question,
              searchText: [question.question, question.evidence && question.evidence.quote].map(text).join(" "),
              detailEntries: [
                ["ID", question.id],
                ["Status", question.status],
              ],
              evidence: question.evidence,
            }),
          );
        }
      }
      questionsSection.append(questionList);

      const glossarySection = section("glossary", "glossary", "Glossary");
      const glossaryList = document.createElement("div");
      glossaryList.className = "list";
      const glossary = snapshot.glossary || [];
      if (glossary.length === 0) {
        glossaryList.append(emptyState("No glossary terms recorded."));
      } else {
        for (const term of glossary) {
          glossaryList.append(
            createRecord({
              type: "glossary",
              status: "active",
              tags: [],
              title: term.term,
              metaLine: "glossary",
              body: term.definition,
              searchText: [term.term, term.definition, term.evidence && term.evidence.quote].map(text).join(" "),
              detailEntries: [
                ["ID", term.id],
              ],
              evidence: term.evidence,
            }),
          );
        }
      }
      glossarySection.append(glossaryList);

      const specSection = section("spec-changes", "spec", "Spec changes");
      const specList = document.createElement("div");
      specList.className = "list";
      const specs = snapshot.specChanges || [];
      if (specs.length === 0) {
        specList.append(emptyState("No spec changes recorded."));
      } else {
        for (const spec of specs) {
          specList.append(
            createRecord({
              type: "spec",
              status: "active",
              tags: [],
              title: spec.section,
              metaLine: "Operation: " + spec.operation,
              body: spec.content,
              searchText: [spec.section, spec.operation, spec.content, spec.evidence && spec.evidence.quote].map(text).join(" "),
              detailEntries: [
                ["ID", spec.id],
                ["Operation", spec.operation],
              ],
              evidence: spec.evidence,
            }),
          );
        }
      }
      specSection.append(specList);

      app.append(decisionsSection, tasksSection, questionsSection, glossarySection, specSection);

      function applyFilters() {
        const query = searchInput.value.trim().toLowerCase();
        const type = typeFilter.value;
        const status = statusFilter.value;
        const tag = tagFilter.value;
        for (const record of app.querySelectorAll("article.record")) {
          const typeOk = type === "all" || record.dataset.type === type;
          const statusOk = status === "all" || record.dataset.status === status;
          const tagOk = tag === "all" || (record.dataset.tags || "").split(" ").includes(tag);
          const searchOk = matchesKeyword(record.dataset.search || "", query);
          record.classList.toggle("hidden", !(typeOk && statusOk && tagOk && searchOk));
        }
        for (const block of app.querySelectorAll("section.block")) {
          block.classList.toggle(
            "hidden",
            !(type === "all" || block.dataset.type === type),
          );
        }
      }

      searchInput.addEventListener("input", applyFilters);
      typeFilter.addEventListener("change", applyFilters);
      statusFilter.addEventListener("change", applyFilters);
      tagFilter.addEventListener("change", applyFilters);
    </script>
  </body>
</html>
`;
}

export async function generateTimeline(
  storeRoot: string,
  outputPath: string,
  options: { generatedAt?: string } = {},
): Promise<void> {
  await generateTimelineFromSnapshot(await readStore(storeRoot), outputPath, options);
}

/**
 * Write a static timeline from an already-read approved-store snapshot.
 * This lets command surfaces share one application-level store reader while
 * retaining the original store-root convenience API for callers and fixtures.
 */
export async function generateTimelineFromSnapshot(
  snapshot: StoreSnapshot,
  outputPath: string,
  options: { generatedAt?: string } = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderTimelineHtml(snapshot, options), "utf8");
}
