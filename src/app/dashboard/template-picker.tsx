// The template choices, each shown as a small live preview of the real template filled with an invented match.
// Server component: the inputs belong to the form on the dashboard page.

type Tile = { key: string; name: string; note: string; html: string };

export default function TemplatePicker({ tiles, current }: { tiles: Tile[]; current: string }) {
  return (
    <div className="tpl-grid" role="radiogroup" aria-label="Template">
      {tiles.map((t) => (
        <label key={t.key} className="tpl-pick">
          <input type="radio" name="template" value={t.key} defaultChecked={t.key === current} />
          <span className="tpl-frame">
            <iframe srcDoc={t.html} sandbox="" title={`${t.name} preview`} tabIndex={-1} scrolling="no" loading="lazy" />
          </span>
          <span className="tpl-name">{t.name}</span>
          <small>{t.note}</small>
        </label>
      ))}
    </div>
  );
}
