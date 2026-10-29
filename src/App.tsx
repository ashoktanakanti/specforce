import { useCallback, useEffect, useState } from "react";
import { call, getRole, setRole as saveRole, type Role } from "./api";
import Settings from "./Settings";
import Upload from "./Upload";
import SpecPage from "./SpecPage";
import type { SpecSummary, SpecView } from "./types";

const ROLES: Role[] = ["Author", "Reviewer", "HOD"];

export default function App() {
  const [settings, setSettings] = useState(false);
  const [role, setRole] = useState<Role>(getRole());
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [current, setCurrent] = useState<SpecView | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  const refresh = useCallback(() => call<SpecSummary[]>("/specs").then(setSpecs).catch(() => {}), []);
  useEffect(() => { call("/health").then(() => setOnline(true)).catch(() => setOnline(false)); refresh(); }, [refresh]);

  const open = (id: string) => call<SpecView>(`/specs/${id}`).then(setCurrent);
  const changeRole = (r: Role) => { saveRole(r); setRole(r); if (current) open(current.id); };
  const onChange = (v: SpecView) => { setCurrent(v); refresh(); };

  return (
    <div className="shell">
      <header className="top">
        <button className="brand" onClick={() => setCurrent(null)}>
          <span className="mark" aria-hidden>§</span>
          <span><b>SpecForge</b><small>course specs, corrected</small></span>
        </button>
        <div className="roles" role="radiogroup" aria-label="Acting as">
          {ROLES.map((r) => (
            <button key={r} role="radio" aria-checked={role === r} className={role === r ? "on" : ""} onClick={() => changeRole(r)}>{r}</button>
          ))}
        </div>
        <span className={`dot ${online ? "up" : online === false ? "down" : ""}`} title={online ? "Server up" : "Server not reachable"} />
        <button className="ghost icon" onClick={() => setSettings(true)} aria-label="AI settings">⚙ <span>AI key</span></button>
      </header>

      <div className="body">
        <aside className="rail">
          <p className="eyebrow">Specs</p>
          {specs.length === 0 && <p className="muted small">Nothing yet. Generate your first spec.</p>}
          {specs.map((s) => (
            <button key={s.id} className={`specitem ${current?.id === s.id ? "on" : ""}`} onClick={() => open(s.id)}>
              <span className="code">{s.code || "—"}</span>
              <span className="t">{s.title}</span>
              <span className={`status s-${s.status.replace(/\s/g, "")}`}>{s.status}</span>
            </button>
          ))}
          {current && role === "Author" && <button className="ghost new" onClick={() => setCurrent(null)}>+ New spec</button>}
        </aside>

        <main className="main">
          {current
            ? <SpecPage key={current.id} spec={current} role={role} onChange={onChange} />
            : <Upload role={role} onDone={onChange} openSettings={() => setSettings(true)} />}
        </main>
      </div>
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}
