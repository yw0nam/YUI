/** The stage's foot: her name over her transport and window state. */

export function StageFoot(p: { name: string; line: string }) {
  return (
    <div className="yui-settings-stage__foot">
      <span className="yui-settings-stage__name">{p.name}</span>
      <span className="yui-settings-stage__meta">{p.line}</span>
    </div>
  );
}
