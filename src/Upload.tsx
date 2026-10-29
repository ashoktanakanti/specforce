import { useEffect, useRef, useState } from "react";
import { call, loadSettings, type Role } from "./api";
import type { SpecView } from "./types";

const STEPS = ["Reading your files", "Pulling out outcomes, units and tables", "Mapping outcomes to POs and PSOs", "Checking for problems"];
const ACCEPT = ".docx,.doc,.pdf,.html,.htm";

function Drop({ label, hint, file, onFile, required }: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop ${file ? "has" : ""} ${over ? "over" : ""}`}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0] ?? null); }}
      role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}
    >
      <input ref={ref} type="file" accept={ACCEPT} hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <p className="eyebrow">{label}{required ? "" : " · optional"}</p>
      {file ? <p className="fname">{file.name}<button className="x" onClick={(e) => { e.stopPropagation(); onFile(null); }} aria-label="Remove">×</button></p>
        : <p className="muted">{hint}</p>}
      <p className="tiny muted">.docx · .doc · .pdf · .html</p>
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

  return (
    <section className="hero">
      <p className="eyebrow">New course specification</p>
      <h1>Hand over the messy spec.<br /><em>Get back one that adds up.</em></h1>
      <p className="lede">SpecForge reads the existing course spec and the question-paper blueprint, rebuilds it in the official template, re-derives the CO–PO–PSO map with a reason for every cell, and explains each outcome in plain words.</p>

      {role !== "Author" ? (
        <div className="note">You are acting as <b>{role}</b>. Only the Author uploads files. Pick a spec on the left to review it, or switch to Author.</div>
      ) : busy ? (
        <ol className="progress" aria-live="polite">
          {STEPS.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>{s}</li>)}
          <li className="muted small">This takes about a minute with a free model.</li>
        </ol>
      ) : (
        <>
          <div className="drops">
            <Drop label="Existing course spec" hint="Drop the current spec here, or click to choose" file={spec} onFile={setSpec} required />
            <Drop label="Question-paper blueprint" hint="Drop the blueprint: it decides the COs and units" file={bp} onFile={setBp} />
          </div>
          <div className="go">
            {!hasKey && <p className="warn">Add your Gemini or OpenRouter key first. <button className="link" onClick={openSettings}>Open AI settings</button></p>}
            <button className="primary" disabled={!spec || !hasKey} onClick={go}>Forge the spec →</button>
          </div>
        </>
      )}
      {err && <p className="bad" role="alert">{err}</p>}

      <div className="how">
        <div><b>1</b><p>Blueprint decides the outcomes and units. Everything else comes from the existing spec.</p></div>
        <div><b>2</b><p>The map is rebuilt from each outcome's Bloom's level, never copied.</p></div>
        <div><b>3</b><p>Author edits, Reviewer comments, HOD approves. Then the DRAFT stamp comes off.</p></div>
      </div>
    </section>
  );
}
