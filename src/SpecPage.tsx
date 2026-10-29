import { useEffect, useState } from "react";
import { call } from "./api";
import type { Reference, SpecView } from "./types";

const BLOOM = ["", "Remember", "Understand", "Apply", "Analyse", "Evaluate", "Create"];
type Tab = "outcomes" | "map" | "issues" | "document";

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function reportHtml(s: SpecView) {
  const rows = s.defects.map((d) => `<tr><td>${d.severity}</td><td>${d.code}</td><td>${d.location.source} §${d.location.section ?? "–"} ${d.location.refs.join(", ")}</td><td>${esc(d.description)}</td><td>${esc(d.fix)}</td></tr>`).join("");
  const checks = s.checks.map((c) => `<tr><td>${c.id}</td><td>${c.pass ? "PASS" : "FAIL"}</td><td>${esc(c.rule)}</td><td>${esc(c.detail)}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Validation report – ${esc(s.model.header.code)}</title><style>body{font:14px system-ui;margin:32px;max-width:1100px}table{border-collapse:collapse;width:100%;margin:12px 0 28px}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}</style>
<h1>Validation report: ${esc(s.model.header.title)} (${esc(s.model.header.code)})</h1><p>Template: ${s.model.template}. ${esc(s.model.templateSignals.join("; "))}${s.model.hasBlueprint ? "" : " · No blueprint supplied."}</p>
<h2>Rules V1–V10</h2><table><tr><th>Rule</th><th>Result</th><th>Check</th><th>Detail</th></tr>${checks}</table>
<h2>Problems found in the inputs (${s.defects.length})</h2><table><tr><th>Severity</th><th>Code</th><th>Where</th><th>Problem</th><th>Fix applied</th></tr>${rows}</table>`;
}

export default function SpecPage({ spec, onChange }: { spec: SpecView; onChange: (v: SpecView) => void }) {
  const [tab, setTab] = useState<Tab>("outcomes");
  const [ref, setRef] = useState<Reference | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{ co: string; col: string } | null>(null);
  const [summary, setSummary] = useState(spec.model.summary);
  const m = spec.model;
  const canEdit = spec.status === "Draft" || spec.status === "Returned";
  const cols = ref ? [...ref.pos.map((p) => p.id), ...ref.psos.map((p) => p.id)] : [];

  useEffect(() => { call<Reference>("/reference").then(setRef).catch(() => {}); }, []);
  useEffect(() => setSummary(spec.model.summary), [spec.model.summary]);

  async function run(path: string, body: unknown, method = "POST") {
    setBusy(true); setErr("");
    try { onChange(await call<SpecView>(`/specs/${spec.id}${path}`, { method, body: JSON.stringify(body) })); return true; }
    catch (e) { setErr((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  const setCell = (co: string, col: string, level: 1 | 2 | 3 | null) => run("", { map: { [co]: { [col]: level } } }, "PATCH");
  const overrideTemplate = () => {
    const next = m.template === "integrated" ? "non_lab" : "integrated";
    const reason = next === m.templateDetected ? "" : window.prompt(`Why use the ${next === "integrated" ? "Integrated" : "Non-Lab"} template instead of the detected one?`) ?? "";
    if (next !== m.templateDetected && !reason.trim()) return;
    run("", { template: next, templateOverrideReason: reason }, "PATCH");
  };

  const sev = (s: string) => spec.defects.filter((d) => d.severity === s).length;
  const passed = spec.checks.filter((c) => c.pass).length;
  const cell = picked ? m.map[picked.co]?.[picked.col] : undefined;
  const colInfo = picked && ref ? ref.pos.find((p) => p.id === picked.col) ?? ref.psos.find((p) => p.id === picked.col) : undefined;

  return (
    <article className="spec">
      <header className="spechead">
        <div>
          <p className="eyebrow">{m.header.code} · {m.header.department}</p>
          <h1>{m.header.title}</h1>
          <p className="meta">
            <span className="chip">L:T:P {m.ltp}</span>
            <span className={`chip tpl ${m.template}`}>{m.template === "integrated" ? "Integrated (theory + lab)" : "Non-Lab"}</span>
            {m.template !== m.templateDetected && <span className="chip warnchip" title={m.templateOverrideReason}>overridden</span>}
            {canEdit && <button className="link" onClick={overrideTemplate}>switch template</button>}
            {!m.hasBlueprint && <span className="chip warnchip">no blueprint supplied</span>}
          </p>
        </div>
        <div className="exports">
          <button className="ghost" onClick={() => download("spec.html", spec.html, "text/html")}>spec.html</button>
          <button className="ghost" onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write(spec.html); w.document.close(); setTimeout(() => w.print(), 400); } }}>PDF</button>
          <button className="ghost" onClick={() => download("specforge_output.json", JSON.stringify(spec.output, null, 2), "application/json")}>output.json</button>
          <button className="ghost" onClick={() => download("validation_report.html", reportHtml(spec), "text/html")}>report</button>
        </div>
      </header>

      {err && <p className="bad" role="alert">{err}</p>}

      <nav className="tabs" role="tablist">
        {([["outcomes", "Outcomes, simply"], ["map", "CO–PO–PSO map"], ["issues", `Issues · ${spec.defects.length}`], ["document", "Document"]] as [Tab, string][]).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </nav>

      {tab === "outcomes" && (
        <section>
          <div className="summary">
            <p className="eyebrow">What this course is about</p>
            {canEdit ? <>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={5} />
              {summary !== m.summary && <button disabled={busy} onClick={() => run("", { summary }, "PATCH")}>Save summary</button>}
            </> : <p>{m.summary}</p>}
          </div>
          <div className="cos">
            {m.cos.map((c) => (
              <div className="co" key={c.id}>
                <div className="cohead"><span className="coid">{c.id}</span><span className={`bloom b${c.bloom}`}>L{c.bloom} · {BLOOM[c.bloom]}</span></div>
                <p className="plain">{c.plain || c.statement}</p>
                {c.example && <p className="example"><span>For example</span>{c.example}</p>}
                <p className="official"><span>Official wording</span>{c.statement}</p>
              </div>
            ))}
          </div>
          <p className="eyebrow">Units</p>
          <ol className="units">
            {m.units.map((u) => <li key={u.number}><b>{u.title}</b>{u.hours ? <span className="muted"> · {u.hours} h</span> : null}<p className="muted small">{u.content}</p>{m.template === "integrated" && u.lab && <p className="lab">Lab: {u.lab}</p>}</li>)}
          </ol>
        </section>
      )}

      {tab === "map" && (
        <section className="mapwrap">
          <div className="legend"><span className="l3">3 very strong</span><span className="l2">2 strong</span><span className="l1">1 moderate</span><span className="l0">blank: no link</span><span className="muted small">Click a cell to see why{canEdit ? " or change it" : ""}.</span></div>
          <div className="scroll">
            <table className="heat">
              <thead><tr><th></th>{cols.map((c) => <th key={c} title={ref?.pos.find((p) => p.id === c)?.title ?? c}>{c.replace("PSO-", "PSO ").replace("PO-", "PO ")}</th>)}</tr></thead>
              <tbody>
                {m.cos.map((c) => (
                  <tr key={c.id}>
                    <th><span>{c.id}</span><small>L{c.bloom}</small></th>
                    {cols.map((col) => {
                      const v = m.map[c.id]?.[col];
                      const on = picked?.co === c.id && picked.col === col;
                      return <td key={col}><button className={`hc l${v?.level ?? 0} ${on ? "sel" : ""}`} onClick={() => setPicked({ co: c.id, col })} title={v?.justification ?? "No link"} aria-label={`${c.id} ${col}: ${v?.level ?? "blank"}`}>{v?.level ?? ""}</button></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {picked && (
            <div className="why">
              <p className="eyebrow">{picked.co} → {picked.col}{colInfo && "title" in colInfo ? ` · ${colInfo.title}` : ""}</p>
              <p className="big">{cell ? `${cell.level} — ${["", "moderate", "strong", "very strong"][cell.level]}` : "No link"}</p>
              <p>{cell?.justification ?? "The outcome does not build this programme outcome, so the cell stays blank."}</p>
              {colInfo && <p className="muted small">{colInfo.statement}</p>}
              {canEdit && <div className="row">{([null, 1, 2, 3] as const).map((l) => <button key={String(l)} className={(cell?.level ?? null) === l ? "" : "ghost"} disabled={busy} onClick={() => setCell(picked.co, picked.col, l)}>{l ?? "blank"}</button>)}</div>}
            </div>
          )}
        </section>
      )}

      {tab === "issues" && (
        <section>
          <div className="counts">
            <div className="ct high"><b>{sev("High")}</b>high</div>
            <div className="ct med"><b>{sev("Medium")}</b>medium</div>
            <div className="ct low"><b>{sev("Low")}</b>low</div>
            <div className="ct ok"><b>{passed}/{spec.checks.length}</b>checks pass</div>
          </div>
          <p className="eyebrow">Problems found in the uploaded documents, and what was done</p>
          <ul className="defects">
            {(["High", "Medium", "Low"] as const).flatMap((s) => spec.defects.filter((d) => d.severity === s)).map((d, i) => (
              <li key={i} className={`def ${d.severity}`}>
                <div className="dtop"><code>{d.code}</code><span className="where">{d.location.source}{d.location.section ? ` · §${d.location.section}` : ""}{d.location.refs.length ? ` · ${d.location.refs.join(", ")}` : ""}</span></div>
                <p>{d.description}</p>
                <p className="fix">→ {d.fix}</p>
              </li>
            ))}
            {spec.defects.length === 0 && <li className="muted">No problems found in the inputs.</li>}
          </ul>
          <p className="eyebrow">Validation of the corrected spec (rules V1–V10, plain code)</p>
          <ul className="checks">
            {spec.checks.map((c) => <li key={c.id} className={c.pass ? "pass" : "fail"}><span className="ck">{c.pass ? "✓" : "✗"}</span><b>{c.id}</b> {c.rule}<span className="muted small"> — {c.detail}</span></li>)}
          </ul>
        </section>
      )}

      {tab === "document" && (
        <section className="doc">
          <iframe title="Course specification document" srcDoc={spec.html} />
        </section>
      )}

    </article>
  );
}
