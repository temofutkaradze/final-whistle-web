import type { BuilderConfig } from "@/lib/template-builder";

export type Editing = { key: string; name: string; html: string; config: BuilderConfig | null; ownId: string | null };
export type SaveState = { error: string } | null;
export type SaveAction = (prev: SaveState, formData: FormData) => Promise<SaveState>;
