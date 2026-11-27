"use client";

import { useId } from "react";
import type { Opt } from "./definitions";

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Opt[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
export function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </label>
  );
}
export function RangeField({ label, value, min, max, step = 1, unit = "", onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label} ({value}
      {unit})
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} />
    </label>
  );
}
export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function PreviewFrame({ html, title }: { html: string; title: string }) {
  return (
    <div className="add-preview" role="region" aria-label={title}>
      {html ? <iframe srcDoc={html} sandbox="" title={title} tabIndex={-1} scrolling="no" /> : <p>Nothing to preview yet.</p>}
    </div>
  );
}
