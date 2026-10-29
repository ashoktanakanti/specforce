import { useCallback, useEffect, useState } from "react";
import { call, getRole, setRole as saveRole, type Role } from "./api";
import Guide, { type GuideStep } from "./Guide";
import Settings from "./Settings";
import Upload from "./Upload";
import SpecPage from "./SpecPage";
import type { SpecSummary, SpecView } from "./types";

const ROLES: Role[] = ["Author", "Reviewer", "HOD"];
const ROLE_HINT: Record<Role, string> = { Author: "uploads & edits", Reviewer: "comments & forwards", HOD: "approves" };

const UPLOAD_STEPS: GuideStep[] = [
  { id: "ai-key", text: "Start here! Paste your free Gemini or OpenRouter key, then press “Test key”. It stays in your browser." },
  { id: "roles", text: "Pick who you are. Author uploads & edits, Reviewer comments, HOD gives the final approval." },
  { id: "drop-spec", text: "Drop the course document here: the one with the COs, units, hours and assessment." },
  { id: "drop-bp", text: "Have the exam blueprint? Drop it here too. It decides the final COs and units." },
  { id: "forge", text: "Then press this. It reads everything and fixes it (about a minute)." },
  { id: "index", text: "Every course you've done shows up here, with where it is in the approval chain." },
];
const SPEC_STEPS: GuideStep[] = [
  { id: "flow", text: "Where this course is right now: Draft → Reviewer → HOD → Approved." },
  { id: "actions", text: "Your buttons live here and change with your role. Switch role at the top to see the others." },
  { id: "tab-outcomes", text: "Every Course Outcome in plain words, with an example of what you'll actually do." },
  { id: "tab-map", text: "How each CO links to the POs and PSOs. Click any square to see the reason." },
  { id: "tab-issues", text: "Everything that was wrong in the original document, and how it was fixed." },
  { id: "tab-document", text: "The finished document in the official university format." },
  { id: "tab-review", text: "Reviewer & HOD leave comments here. The history shows who did what, and when." },
  { id: "exports", text: "Download the document, print it as PDF, or grab the scoring file." },
];

const seen = (k: string) => { try { return localStorage.getItem(`specforge.guide.${k}`) === "1"; } catch { return true; } };
const markSeen = (k: string) => { try { localStorage.setItem(`specforge.guide.${k}`, "1"); } catch { /* ignore */ } };

export default function App() {
  const [settings, setSettings] = useState(false);
  const [role, setRole] = useState<Role>(getRole());
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [current, setCurrent] = useState<SpecView | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const screen = current ? "spec" : "upload";
  const [guide, setGuide] = useState(false);

  const refresh = useCallback(() => call<SpecSummary[]>("/specs").then(setSpecs).catch(() => {}), []);
  useEffect(() => { call("/health").then(() => setOnline(true)).catch(() => setOnline(false)); refresh(); }, [refresh]);
  // Show the pencil guide automatically the first time each screen is seen.
  useEffect(() => { if (!seen(screen)) { const t = setTimeout(() => setGuide(true), 600); return () => clearTimeout(t); } }, [screen]);

  const open = (id: string) => call<SpecView>(`/specs/${id}`).then(setCurrent);
  const changeRole = (r: Role) => { saveRole(r); setRole(r); if (current) open(current.id); };
  const onChange = (v: SpecView) => { setCurrent(v); refresh(); };
  const closeGuide = () => { markSeen(screen); setGuide(false); };

  return (
    <div className="shell">
      <header className="top">
        <button className="brand" onClick={() => setCurrent(null)}>
          <span className="mark" aria-hidden>§</span>
          <span><b>SpecForge</b><small>course outcomes, made clear</small></span>
        </button>
        <div className="roles" role="radiogroup" aria-label="Acting as" data-guide="roles">
          {ROLES.map((r) => (
            <button key={r} role="radio" aria-checked={role === r} className={role === r ? "on" : ""} onClick={() => changeRole(r)} title={`${r}: ${ROLE_HINT[r]}`}>{r}</button>
          ))}
        </div>
        <span className={`dot ${online ? "up" : online === false ? "down" : ""}`} title={online ? "Server up" : "Server not reachable"} />
        <button className="keybtn" onClick={() => setSettings(true)} aria-label="AI settings" data-guide="ai-key">⚿ AI key</button>
        <button className="helpbtn" onClick={() => setGuide(true)} aria-label="Show the guide" title="Show me around">?</button>
      </header>

      <div className="body">
        <aside className="rail" data-guide="index">
          <div className="railhead">
            <span className="folio" aria-hidden>❦</span>
            <div><b>Curriculum Index</b><small>your courses</small></div>
          </div>
          {role === "Author" && <button className="primary block" onClick={() => setCurrent(null)}>+ New course</button>}
          {specs.length === 0 && <p className="muted small pad">Nothing here yet. Upload your first course.</p>}
          {specs.map((s) => (
            <button key={s.id} className={`specitem ${current?.id === s.id ? "on" : ""}`} onClick={() => open(s.id)}>
              <span className="code">{s.code || "—"}</span>
              <span className="t">{s.title}</span>
              <span className={`status s-${s.status.replace(/\s/g, "")}`}>{s.status}</span>
            </button>
          ))}
        </aside>

        <main className="main">
          {current
            ? <SpecPage key={current.id} spec={current} role={role} onChange={onChange} />
            : <Upload role={role} onDone={onChange} openSettings={() => setSettings(true)} />}
        </main>
      </div>
      {settings && <Settings onClose={() => setSettings(false)} />}
      {guide && !settings && <Guide key={screen} steps={screen === "spec" ? SPEC_STEPS : UPLOAD_STEPS} onClose={closeGuide} />}
    </div>
  );
}
