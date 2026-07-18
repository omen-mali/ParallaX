import { describe, expect, it } from "vitest";

import { UI_API_PATHS, UI_SESSION_HEADER, renderUiHtml } from "../../src/ui/page.js";

describe("local UI page shell", () => {
  it("contains only static markup and uses DOM text APIs for fetched content", () => {
    const html = renderUiHtml({ nonce: `safe\"'><script>` });

    expect(html).toContain('nonce="safe&quot;&#39;&gt;&lt;script&gt;"');
    expect(html).toContain(UI_SESSION_HEADER);
    expect(html).toContain(UI_API_PATHS.snapshot);
    expect(html).toContain(UI_API_PATHS.config);
    expect(html).toContain(UI_API_PATHS.inspectImport);
    expect(html).toContain(UI_API_PATHS.previewImport);
    expect(html).toContain(UI_API_PATHS.compile);
    expect(html).toContain("File.text()");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toContain("indexedDB");
    expect(html).not.toContain("document.cookie");
    expect(html).not.toContain("setInterval(");
    expect(html).not.toContain("style=");
  });

  it("keeps the session capability in the fragment for refreshes and starts proposal items unchecked", () => {
    const html = renderUiHtml({ nonce: "test-nonce" });

    expect(html).toContain("window.location.hash.slice(1)");
    expect(html).not.toContain("history.replaceState");
    expect(html).toContain('checkbox.type = "checkbox"');
    expect(html).not.toContain("checkbox.checked = true");
    expect(html).toContain("Apply selected items?");
    expect(html).toContain("Keep this import metadata-only");
    expect(html).toContain(
      "Transcript retention was disabled for this metadata-only source.",
    );
    expect(html).toContain("quote hash ");
    expect(html).toContain("clearProposal();\n        previewButton.disabled = true;");
    expect(html).toContain("Maximum request size: 25 MiB.");
  });

  it("groups the import controls into a centered, responsive form layout", () => {
    const html = renderUiHtml({ nonce: "test-nonce" });

    expect(html).toContain('class="fields import-form"');
    expect(html).toContain('class="import-input"');
    expect(html).toContain('class="inline-options input-mode-options"');
    expect(html).toContain('class="field import-source"');
    expect(html).toContain('class="import-settings"');
    expect(html).toContain('class="actions import-actions"');
    expect(html).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(html).toContain(
      ".import-settings { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
    );
  });

  it("emits a syntactically valid browser script", () => {
    const html = renderUiHtml({ nonce: "test-nonce" });
    const script = html.match(
      /<script nonce="test-nonce">\n([\s\S]*?)\n    <\/script>/,
    )?.[1];

    expect(script).toBeDefined();
    expect(() => new Function(script ?? "")).not.toThrow();
  });
});
