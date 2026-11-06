// The template choices, each shown as a small live preview of the real template filled with an invented match.
// Server component: the inputs belong to the form on the dashboard page. The "+" tile opens the Add template panel
// (a plain link: the panel shows itself with CSS :target). Every template has an Edit link (?edit=<key>); a customer's own
// template also has a Delete button that belongs to the same form (formAction), so no form is nested inside another.

type Tile = { key: string; name: string; note: string; html: string; custom: boolean };

export default function TemplatePicker({
  tiles,
  current,
  canAdd,
  deleteAction,
}: {
  tiles: Tile[];
  current: string;
  canAdd: boolean;
  deleteAction: (id: string, formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="tpl-grid" role="radiogroup" aria-label="Template">
      {tiles.map((t) => (
        <div key={t.key} className="tpl-cell">
          <label className="tpl-pick">
            <input type="radio" name="template" value={t.key} defaultChecked={t.key === current} />
            <span className="tpl-frame">
              <iframe srcDoc={t.html} sandbox="" title={`${t.name} preview`} tabIndex={-1} scrolling="no" loading="lazy" />
              <span className="tpl-check" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
                </svg>
              </span>
            </span>
            <span className="tpl-name">{t.name}</span>
            <small>{t.note}</small>
          </label>
          <div className="tpl-actions">
            <a className="btn ghost tpl-sm" href={`/dashboard/match?edit=${encodeURIComponent(t.key)}#add-template`}>
              Edit
            </a>
            {t.custom && (
              <button type="submit" className="ghost tpl-sm" formAction={deleteAction.bind(null, t.key.replace("custom:", ""))} formNoValidate>
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
      {canAdd ? (
        <a className="tpl-add" href="/dashboard/match#add-template">
          <span className="tpl-plus" aria-hidden="true">
            +
          </span>
          <span className="tpl-name">Add template</span>
          <small>Paste HTML or build one</small>
        </a>
      ) : (
        <p className="muted tpl-limit">Limit of own templates reached.</p>
      )}
    </div>
  );
}
