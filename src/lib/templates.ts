import { readFile } from "node:fs/promises";
import path from "node:path";
import { fillPlaceholders } from "@/lib/sample-match";
import { previewDocument } from "../../render/final-document.js";

// Built-in templates: the files live in render/templates/<key>.html (the render server reads the same files).
export const BUILTIN_TEMPLATES = [
  { key: "classic", name: "Classic", note: "Big score, scorers on both sides." },
  { key: "panel", name: "Panel", note: "Dark panel under the photo." },
  { key: "frame", name: "Frame", note: "Thin frame, centred score." },
  { key: "stripe", name: "Stripe", note: "Band across the photo." },
] as const;

export const MAX_CUSTOM_TEMPLATES = 12;

export function isBuiltinTemplate(key: string): boolean {
  return BUILTIN_TEMPLATES.some((t) => t.key === key);
}

// Brand.templateRef is "classic" (a built-in key) or "custom:<template id>".
export function customTemplateId(ref: string): string | null {
  return ref.startsWith("custom:") ? ref.slice("custom:".length) : null;
}

const TEMPLATES_DIR = path.join(process.cwd(), "render", "templates");

export async function builtinTemplateHtml(key: string): Promise<string> {
  const safeKey = isBuiltinTemplate(key) ? key : "classic";
  return readFile(path.join(TEMPLATES_DIR, `${safeKey}.html`), "utf8");
}

// Preview of any template html (built-in or the customer's own): filled with the invented match and locked down.
export function previewHtml(html: string, brandHtml: string): string {
  return previewDocument(fillPlaceholders(html, brandHtml));
}
