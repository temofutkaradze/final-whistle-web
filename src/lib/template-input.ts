import { MAX_HTML_CHARS, checkTemplateHtml } from "../../render/template-check.js";
import { buildTemplateHtml, normalizeConfig, type BuilderConfig } from "@/lib/template-builder";

// Turns the "Add / edit template" form into a checked template, or a message for the customer.
// Nothing from the browser is trusted: the options are forced back into the allowed values and the HTML is checked again.
export type PreparedTemplate = { ok: true; name: string; html: string; config: BuilderConfig | null } | { ok: false; error: string };

export function prepareTemplateInput(formData: FormData): PreparedTemplate {
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!name) return { ok: false, error: "Give the template a name." };

  let html: string;
  let config: BuilderConfig | null = null;
  if (String(formData.get("kind") ?? "") === "build") {
    let raw: unknown = {};
    try {
      raw = JSON.parse(String(formData.get("config") ?? "{}"));
    } catch {
      return { ok: false, error: "The options could not be read. Reload the page and try again." };
    }
    config = normalizeConfig(raw);
    html = buildTemplateHtml(config);
  } else {
    html = String(formData.get("html") ?? "").slice(0, MAX_HTML_CHARS + 1);
  }

  const check = checkTemplateHtml(html);
  if (!check.ok) return { ok: false, error: `The template did not pass the safety check. ${check.errors.slice(0, 3).join(" ")}` };
  return { ok: true, name, html, config };
}
