import { describe, expect, it } from "vitest";
import { prepareTemplateInput } from "@/lib/template-input";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const GOOD_HTML = "<html><body>{{HOME_NAME}}{{AWAY_NAME}}{{HOME_SCORE}}-{{AWAY_SCORE}}</body></html>";

describe("prepareTemplateInput (the server side of the Add / Edit template form)", () => {
  it("needs a name", () => {
    for (const name of ["", "   "]) {
      const r = prepareTemplateInput(form({ kind: "html", name, html: GOOD_HTML }));
      expect(r).toMatchObject({ ok: false });
    }
  });

  it("accepts good HTML and cuts the name to 40 characters", () => {
    const r = prepareTemplateInput(form({ kind: "html", name: "x".repeat(100), html: GOOD_HTML }));
    expect(r.ok && r.name.length).toBe(40);
    expect(r.ok && r.config).toBeNull();
  });

  it("refuses HTML that fails the safety check, and says why", () => {
    for (const html of ["<script>alert(1)</script>" + GOOD_HTML, GOOD_HTML.replace("</body>", '<img src="https://google.com/x.png"></body>'), "{{HOME_NAME}}", "x".repeat(250_000)]) {
      const r = prepareTemplateInput(form({ kind: "html", name: "A", html }));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/safety check/);
    }
  });

  it("builds HTML from the options form and forces the options into range", () => {
    const r = prepareTemplateInput(form({ kind: "build", name: "B", config: JSON.stringify({ font: "x</style><script>", shade: "card", offsetY: 99999 }) }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config).toMatchObject({ font: "Montserrat", shade: "card", offsetY: 300 });
      expect(r.html).not.toContain("<script");
    }
  });

  it("explains broken option data instead of crashing", () => {
    const r = prepareTemplateInput(form({ kind: "build", name: "B", config: "{not json" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/options/);
  });

  it("an unknown kind is treated as pasted HTML (and checked like it)", () => {
    expect(prepareTemplateInput(form({ kind: "whatever", name: "A", html: "<script>1</script>" })).ok).toBe(false);
  });
});
