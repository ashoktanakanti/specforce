import { useEffect, useRef, useState } from "react";
import { call, loadSettings, type Role } from "./api";
import type { SpecView } from "./types";

const STEPS = ["Reading your files", "Pulling out outcomes, units and tables", "Mapping outcomes to POs and PSOs", "Checking for problems"];
const ACCEPT = ".docx,.doc,.pdf,.html,.htm";

function Drop({ guide, icon, label, tag, hint, file, onFile }: { guide: string; icon: string; label: string; tag: string; hint: string; file: File | null; onFile: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="dropcard" data-guide={guide}>
      <div className="dchead"><span className="dicon" aria-hidden>{icon}</span><b>{label}</b><span className="tag">{tag}</span></div>
      <div
        className={`drop ${file ? "has" : ""} ${over ? "over" : ""}`}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0] ?? null); }}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}
      >
        <input ref={ref} type="file" accept={ACCEPT} hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <span className="bigicon" aria-hidden>⇪</span>
        <p className="dhint">{hint}</p>
        <span className="browse">Browse files</span>
        {file && <p className="fname">✓ {file.name}<button className="x" onClick={(e) => { e.stopPropagation(); onFile(null); }} aria-label="Remove">×</button></p>}
      </div>
      <p className="tiny muted">Accepts .docx · .doc · .pdf · .html</p>
    </div>
  );
}

export default function Upload({ role, onDone, openSettings }: { role: Role; onDone: (v: SpecView) => void; openSettings: () => void }) {
  const [spec, setSpec] = useState<File | null>(null);
  const [bp, setBp] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const hasKey = !!loadSettings().key;

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [busy]);

  async function go() {
    if (!spec) return;
    setBusy(true); setErr("");
    const form = new FormData();
    form.append("spec", spec);
    if (bp) form.append("blueprint", bp);
    try { onDone(await call<SpecView>("/specs", { method: "POST", body: form })); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const ready = !!spec && hasKey;
  return (
    <section className="hero">
      <p className="eyebrow stamp">Course intake</p>
      <h1>Upload your course details.<br /><em>Get back a clean, correct version.</em></h1>
      <p className="lede">Drop in the course document (title, credits, Course Outcomes, units, hours, assessment) and the question-paper blueprint. SpecForge fixes what's wrong, rebuilds the CO–PO–PSO map with a reason for every cell, and explains each Course Outcome in plain words.</p>

      {role !== "Author" ? (
        <div className="note">You are acting as <b>{role}</b>. Only the Author uploads files. Pick a course on the left to review it, or switch to <b>Author</b> at the top.</div>
      ) : busy ? (
        <div className="trace">
          <p className="eyebrow">Working on it · step {step + 1} of {STEPS.length}</p>
          <ol className="progress" aria-live="polite">
            {STEPS.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "now" : ""}><span className="num">{i + 1}</span>{s}<span className="st">{i < step ? "done" : i === step ? "running…" : ""}</span></li>)}
          </ol>
          <p className="muted small">Takes about a minute with a free model. Don't close the tab.</p>
        </div>
      ) : (
        <>
          <div className="drops">
            <Drop guide="drop-spec" icon="📄" label="Course details document" tag="Required" hint="Drop the current course document here (outcomes, units, hours…)" file={spec} onFile={setSpec} />
            <Drop guide="drop-bp" icon="📋" label="Question-paper blueprint" tag="Optional" hint="Drop the exam blueprint: it decides the final COs and units" file={bp} onFile={setBp} />
          </div>
          <div className={`readybar ${ready ? "ready" : ""}`}>
            <div>
              <b>{!hasKey ? "Add your AI key first" : !spec ? "Add the course document to begin" : `Ready to fix ${spec.name}`}</b>
              <p className="muted small">{!hasKey ? <button className="link" onClick={openSettings}>Open AI settings</button> : bp ? "With blueprint: COs and units will come from it." : "No blueprint: COs and units come from the course document."}</p>
            </div>
            <button className="primary" disabled={!ready} onClick={go} data-guide="forge">Fix my course →</button>
          </div>
        </>
      )}
      {err && <p className="bad" role="alert">{err}</p>}

      <div className="how">
        <div><b>1</b><p>The blueprint decides the outcomes and units. Everything else comes from the course document.</p></div>
        <div><b>2</b><p>The map is rebuilt from each outcome's Bloom's level, never copied from the old one.</p></div>
        <div><b>3</b><p>Author edits, Reviewer comments, HOD approves. Then the DRAFT stamp comes off.</p></div>
      </div>
    </section>
  );
}
