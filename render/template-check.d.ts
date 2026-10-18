export const MAX_HTML_CHARS: number;
export const KNOWN_PLACEHOLDERS: string[];
export const REQUIRED: string[];
export function checkTemplateHtml(html: unknown): { ok: boolean; errors: string[]; warnings: string[] };
export function withCsp(html: string): string;
