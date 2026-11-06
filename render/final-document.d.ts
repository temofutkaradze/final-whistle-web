export function prepareDocument(html: string, options?: {imageUrl?: (url: string) => string; preview?: boolean}): {html: string; resources: string[]};
export function expandPlaceholders(html: string, values: Record<string, unknown>): string;
export function previewDocument(html: string): string;
