import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readStore, type StoreSnapshot } from "../store/read.js";

function serializedData(snapshot: StoreSnapshot): string {
  return JSON.stringify(snapshot).replace(/</g, "\\u003c");
}

export function renderTimelineHtml(snapshot: StoreSnapshot): string {
  const data = serializedData(snapshot);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ParallaX Decision Timeline</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { max-width: 52rem; margin: 0 auto; padding: 2rem; background: #f8fafc; color: #172033; }
      h1 { margin-bottom: 0.25rem; } p { color: #526078; }
      .timeline { border-left: 2px solid #7c3aed; margin: 2rem 0; padding-left: 1.5rem; }
      article { position: relative; margin: 0 0 1.5rem; padding: 1rem; background: white; border-radius: 0.5rem; box-shadow: 0 1px 3px #1720331a; }
      article::before { content: ""; position: absolute; width: 0.7rem; height: 0.7rem; left: -1.92rem; top: 1.3rem; border-radius: 50%; background: #7c3aed; }
      time, .tags { font-size: 0.85rem; color: #64748b; } .tags { margin-left: 0.4rem; }
      .empty { border-left: 2px solid #cbd5e1; padding-left: 1rem; }
      @media (prefers-color-scheme: dark) { body { background: #101726; color: #e2e8f0; } article { background: #182238; } p, time, .tags { color: #aab8d0; } }
    </style>
  </head>
  <body>
    <h1>ParallaX</h1>
    <p>Approved project decisions, stored locally and versioned in Git.</p>
    <main id="timeline"></main>
    <script>
      const snapshot = ${data};
      const timeline = document.querySelector("#timeline");
      const decisions = snapshot.decisions.filter((decision) => decision.status === "active");
      if (decisions.length === 0) {
        timeline.innerHTML = '<p class="empty">No approved decisions yet.</p>';
      } else {
        const container = document.createElement("section");
        container.className = "timeline";
        for (const decision of decisions) {
          const article = document.createElement("article");
          const title = document.createElement("h2");
          title.textContent = decision.title;
          const metadata = document.createElement("div");
          const time = document.createElement("time");
          time.dateTime = decision.createdAt;
          time.textContent = new Date(decision.createdAt).toLocaleString();
          metadata.append(time);
          if (decision.tags.length > 0) {
            const tags = document.createElement("span");
            tags.className = "tags";
            tags.textContent = decision.tags.map((tag) => "#" + tag).join(" ");
            metadata.append(tags);
          }
          const body = document.createElement("p");
          body.textContent = decision.decision;
          article.append(title, metadata, body);
          container.append(article);
        }
        timeline.append(container);
      }
    </script>
  </body>
</html>
`;
}

export async function generateTimeline(
  storeRoot: string,
  outputPath: string,
): Promise<void> {
  const snapshot = await readStore(storeRoot);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderTimelineHtml(snapshot), "utf8");
}
