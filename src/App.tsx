import { useCallback, useEffect, useState } from "react";
import { call } from "./api";
import Settings from "./Settings";
import Upload from "./Upload";
import SpecPage from "./SpecPage";
import type { SpecSummary, SpecView } from "./types";

export default function App() {
  const [settings, setSettings] = useState(false);
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [current, setCurrent] = useState<SpecView | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  const refresh = useCallback(() => call<SpecSummary[]>("/specs").then(setSpecs).catch(() => {}), []);
  useEffect(() => { call("/health").then(() => setOnline(true)).catch(() => setOnline(false)); refresh(); }, [refresh]);

  const open = (id: string) => call<SpecView>(`/specs/${id}`).then(setCurrent);
  const onChange = (v: SpecView) => { setCurrent(v); refresh(); };

  return (
    <div className="shell">
      <header className="top">
        <button className="brand" onClick={() => setCurrent(null)}>
          <span className="mark" aria-hidden>§</span>
          <span><b>SpecForge</b><small>course outcomes, made clear</small></span>
        </button>
        <span className={`dot ${online ? "up" : online === false ? "down" : ""}`} title={online ? "Server up" : "Server not reachable"} />
        <button className="ghost icon" onClick={() => setSettings(true)} aria-label="AI settings">⚙ <span>AI key</span></button>
      </header>

      <div className="body">
        <aside className="rail">
          <p className="eyebrow">Courses</p>
          {specs.length === 0 && <p className="muted small">Nothing yet. Upload your first course.</p>}
          {specs.map((s) => (
            <button key={s.id} className={`specitem ${current?.id === s.id ? "on" : ""}`} onClick={() => open(s.id)}>
              <span className="code">{s.code || "—"}</span>
              <span className="t">{s.title}</span>
            </button>
          ))}
          {current && <button className="ghost new" onClick={() => setCurrent(null)}>+ New course</button>}
        </aside>

        <main className="main">
          {current
            ? <SpecPage key={current.id} spec={current} onChange={onChange} />
            : <Upload onDone={onChange} openSettings={() => setSettings(true)} />}
        </main>
      </div>
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}
