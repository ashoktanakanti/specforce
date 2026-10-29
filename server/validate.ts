// Rule-based checks in plain code (no AI). findDefects() lists problems in the INPUT documents (the defects[] of the
// output file); runChecks() is the V1-V10 validation report on the CORRECTED spec.
import { MAP_COLUMNS, PSO_IDS, bloomCeiling, isPracticalOrAssignment, teachingHours, type Defect, type SpecModel } from "./model.js";
import type { BlueprintDoc, SpecDoc } from "./pipeline.js";
import { renderHtml, templateHeadings, templateSamples } from "./render.js";

const normCo = (id: string) => { const n = id.match(/\d+/)?.[0]; return n ? `CO-${Number(n)}` : id.trim(); };
const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findDefects(x: { spec: SpecDoc; bp: BlueprintDoc | null; model: SpecModel; specText: string; summaryOk: boolean; missingThemes: string[] }): Defect[] {
  const { spec, bp, model } = x;
  const out: Defect[] = [];
  const add = (code: Defect["code"], source: Defect["location"]["source"], section: number | null, refs: string[], description: string, fix: string) =>
    out.push({ code, location: { source, section, refs }, description, fix });
  const finalCos = model.cos.map((c) => c.id);
  const finalSet = new Set(finalCos);

  // Section 3: spec COs against the blueprint COs.
  if (bp && model.hasBlueprint) {
    const specCos = new Map(spec.cos.map((c) => [normCo(c.id), c.statement]));
    for (const c of bp.cos) {
      if (!specCos.has(c.id)) add("CO_MISSING_IN_TABLE", "spec", 3, [c.id], `${c.id} is in the blueprint but missing from the spec's Course Outcomes.`, `Added ${c.id} from the blueprint.`);
      else if (normText(specCos.get(c.id)!) !== normText(c.statement)) add("LABEL_OR_TITLE_MISMATCH", "spec", 3, [c.id], `${c.id} wording differs between the spec and the blueprint.`, "Used the blueprint wording.");
    }
    for (const id of specCos.keys()) if (!bp.cos.some((c) => c.id === id)) add("CO_EXTRA_IN_TABLE", "spec", 3, [id], `${id} is in the spec but not in the blueprint.`, `Removed ${id}; the blueprint decides the COs.`);
    if (bp.code && spec.code && normText(bp.code) !== normText(spec.code)) add("LABEL_OR_TITLE_MISMATCH", "spec", null, [], `Course code "${spec.code}" in the spec differs from "${bp.code}" in the blueprint.`, `Used the blueprint code "${bp.code}".`);
    if (bp.title && spec.title && normText(bp.title) !== normText(spec.title)) add("LABEL_OR_TITLE_MISMATCH", "spec", null, [], `Course title "${spec.title}" in the spec differs from "${bp.title}" in the blueprint.`, `Used the blueprint title "${bp.title}".`);
    for (const u of bp.units) {
      const s = spec.units.find((v) => v.number === u.number);
      if (!s) add("LABEL_OR_TITLE_MISMATCH", "spec", 4, [`Unit-${u.number}`], `Unit ${u.number} of the blueprint is missing from the spec.`, "Used the blueprint units.");
      else if (normText(s.title) !== normText(u.title)) add("LABEL_OR_TITLE_MISMATCH", "spec", 4, [`Unit-${u.number}`], `Unit ${u.number} is titled "${s.title}" in the spec but "${u.title}" in the blueprint.`, "Used the blueprint title.");
    }
    // Blueprint arithmetic: unit marks against maximum marks.
    const marks = bp.units.reduce((a, u) => a + (u.marks ?? 0), 0);
    if (bp.max_marks && marks && marks !== bp.max_marks) add("MARKS_INCONSISTENT", "blueprint", null, [], `Unit marks in the blueprint add up to ${marks}, but the maximum marks are ${bp.max_marks}.`, "Reported for the HOD; units and COs are still taken from the blueprint.");
    const bpHours = bp.units.reduce((a, u) => a + (u.hours ?? 0), 0);
    const lect = teachingHours(model).lectures;
    if (bpHours && lect && bpHours !== lect) add("HOURS_INCONSISTENT", "blueprint", null, [], `Blueprint unit hours add up to ${bpHours}, but the spec lists ${lect} lecture hours.`, "Kept the spec's teaching hours; reported the gap.");
  }

  // Section 5: the existing map.
  const oldRows = spec.old_map.rows.map((r) => ({ co: normCo(r.co), values: r.values }));
  for (const id of finalCos) if (!oldRows.some((r) => r.co === id)) add("CO_MISSING_IN_TABLE", "spec", 5, [id], `${id} has no row in the existing CO-PO-PSO map.`, `Mapped ${id} in the new map.`);
  for (const r of oldRows) if (!finalSet.has(r.co)) add("CO_EXTRA_IN_TABLE", "spec", 5, [r.co], `The map has a row for ${r.co}, which is not a defined Course Outcome.`, `Removed the ${r.co} row.`);
  const extraPso = spec.old_map.columns.map((c) => c.toUpperCase().replace(/\s/g, "")).filter((c) => /^PSO-?\d+$/.test(c)).map((c) => c.replace(/^PSO-?/, "PSO-")).filter((c) => !PSO_IDS.includes(c));
  if (extraPso.length) add("PSO_COLUMN_MISMATCH", "spec", 5, extraPso, `The map has ${extraPso.join(", ")}, but the programme defines only ${PSO_IDS.join(" and ")}.`, `Removed ${extraPso.join(", ")}.`);
  for (const r of oldRows) {
    const co = model.cos.find((c) => c.id === r.co);
    if (!co) continue;
    const over: string[] = [], unsupported: string[] = [];
    for (const [rawCol, v] of Object.entries(r.values)) {
      const col = rawCol.toUpperCase().replace(/\s/g, "").replace(/^(PSO|PO)-?(\d+)$/, "$1-$2");
      const level = Number(v);
      if (!MAP_COLUMNS.includes(col) || !(level >= 1)) continue;
      if (level > bloomCeiling(col, co.bloom)) over.push(col);
      else if (/^PO-(6|7|8|9|10)$/.test(col) && !model.map[co.id]?.[col]) unsupported.push(col);
    }
    if (over.length) add("MAPPING_BLOOM_MISMATCH", "spec", 5, [co.id, ...over], `${co.id} is a Bloom's L${co.bloom} outcome but was mapped above what that level supports on ${over.join(", ")}.`, "Re-derived those cells within the Bloom's ceiling.");
    if (unsupported.length) add("MAPPING_UNSUPPORTED", "spec", 5, [co.id, ...unsupported], `${co.id} was mapped to ${unsupported.join(", ")} with no evidence in the syllabus or assessment.`, "Left those cells blank.");
  }

  // Section 7: assessment.
  const assessed = spec.assessment.rows.map((r) => ({ co: normCo(r.co), comps: r.components }));
  for (const r of assessed) if (!finalSet.has(r.co)) add("CO_EXTRA_IN_TABLE", "spec", 7, [r.co], `The assessment table lists ${r.co}, which is not a defined Course Outcome.`, `Removed the ${r.co} row.`);
  for (const id of finalCos) {
    const row = assessed.find((r) => r.co === id);
    if (!row) add("CO_MISSING_IN_TABLE", "spec", 7, [id], `${id} has no row in the assessment table.`, `Flagged: ${id} must be assigned to an assessment component.`);
    else if (!row.comps.length) add("CO_ASSESSMENT_MISMATCH", "spec", 7, [id], `${id} is not assessed in any component.`, `Flagged: ${id} must be assigned to an assessment component.`);
  }
  // Components that carry marks but assess no defined CO (e.g. only an undefined CO was marked against them).
  const usedBy = (name: string) => assessed.some((r) => finalSet.has(r.co) && r.comps.some((c) => normText(c) === normText(name)));
  const idle = model.assessment.columns.filter((c) => c.weight_percent > 0 && !usedBy(c.name));
  if (idle.length && assessed.length) {
    const share = Math.round(idle.reduce((a, c) => a + c.weight_percent, 0) * 100) / 100;
    const onlyUndefined = assessed.filter((r) => !finalSet.has(r.co) && r.comps.some((c) => idle.some((i) => normText(i.name) === normText(c)))).map((r) => r.co);
    add("CO_ASSESSMENT_MISMATCH", "spec", 7, [...idle.map((c) => c.name), ...onlyUndefined],
      `${idle.map((c) => `"${c.name}"`).join(" and ")} carr${idle.length > 1 ? "y" : "ies"} ${share}% of the marks but assess no defined Course Outcome${onlyUndefined.length ? ` (only ${onlyUndefined.join(", ")} was marked against ${idle.length > 1 ? "them" : "it"})` : ""}.`,
      "Flagged for the Course Leader to assign Course Outcomes to these components.");
  }
  if (spec.assessment.groups.length) {
    const w = spec.assessment.groups.reduce((a, g) => a + g.weight_percent, 0);
    if (Math.abs(w - 100) > 0.01) add("WEIGHTAGE_INCONSISTENT", "spec", 7, [], `Assessment weightages add up to ${w}%, not 100%.`, "Reported for correction.");
  }

  // Section 6: teaching hours.
  for (const g of spec.teaching.groups) {
    const items = g.items.reduce((a, i) => a + i.hours, 0);
    if (g.items.length && items !== g.hours) add("HOURS_INCONSISTENT", "spec", 6, [], `"${g.name}" says ${g.hours} hours but its rows add up to ${items}.`, "Used the sum of the rows.");
  }
  const sum = spec.teaching.groups.reduce((a, g) => a + g.hours, 0);
  if (spec.teaching.stated_total != null && sum && spec.teaching.stated_total !== sum) add("HOURS_INCONSISTENT", "spec", 6, [], `Teaching hours add up to ${sum}, but the stated total is ${spec.teaching.stated_total}.`, `Recomputed the total as ${sum}.`);
  // Section 2 states total interaction hours; the teaching table must agree with it.
  const interaction = spec.credits.find((c) => /interaction/i.test(c.label));
  const interactionHours = interaction ? Number(String(interaction.value).replace(/[^\d.]/g, "")) : 0;
  if (interactionHours && sum && interactionHours !== sum) add("HOURS_INCONSISTENT", "spec", 6, [], `Total Hours of Interaction is ${interactionHours} in the credits table, but teaching and learning hours add up to ${sum}.`, "Reported for correction; teaching hours are kept as listed.");

  // Template choice and signals.
  const ptype = /laborator|\blab\b|practical/i.test(spec.course_type), pcred = Number(model.ltp.split(":")[2]) > 0;
  if (ptype !== pcred) add("WRONG_TEMPLATE", "template", 2, [], `Course type "${spec.course_type}" and credit structure ${model.ltp} disagree on whether the course has a lab.`, `Chose the ${model.template === "integrated" ? "Integrated" : "Non-Lab"} template.`);

  // Section 4: a lab line that names its unit ("Lab Exercises on <title>") must use the unit's own title.
  for (const u of spec.units) {
    const named = u.lab?.match(/^\s*lab(?:oratory)?\s+exercises?\s+on\s+(.+?)\.?\s*$/i)?.[1];
    if (!named) continue;
    const a = normText(named), b = normText(u.title);
    const words = (x: string) => x.toLowerCase().split(/\W+/).filter(Boolean);
    const shared = words(named).filter((w) => words(u.title).includes(w)).length;
    if (a === b || a.startsWith(b) || shared < 2) continue;
    add("LABEL_OR_TITLE_MISMATCH", "spec", 4, [`Unit-${u.number}`], `The lab exercises of Unit ${u.number} are labelled "${named}", but the unit is titled "${u.title}".`, `Labelled them with the unit title "${u.title}".`);
    const fixed = model.units.find((m) => m.number === u.number);
    if (fixed?.lab) fixed.lab = fixed.lab.replace(named, u.title);
  }

  // Summary vs syllabus (AI judgement on the original summary).
  if (!x.summaryOk) add("SUMMARY_SYLLABUS_MISMATCH", "spec", 1, [], `The course summary does not cover: ${x.missingThemes.join("; ") || "some unit themes"}.`, "Rewrote the summary to cover every unit.");

  // Section headings written differently from the template (e.g. wrong capitalisation).
  const specLines = x.specText.split("\n").map((l) => l.trim()).filter(Boolean);
  templateHeadings(model.template).forEach((h, i) => {
    const line = specLines.find((l) => normText(l) === normText(h));
    if (line && line !== h) add("TYPO_OR_FORMAT", "spec", i + 1, [], `Section heading "${line}" should read "${h}".`, `Used the template heading "${h}".`);
  });

  // Which template section a piece of spec text sits in: the last section heading above its first appearance.
  const headingAt = templateHeadings(model.template).map((h, i) => ({ n: i + 1, at: specLines.findIndex((l) => normText(l).startsWith(normText(h))) })).filter((h) => h.at >= 0);
  const sectionOf = (text: string): number | null => {
    const at = specLines.findIndex((l) => normText(l).includes(normText(text)));
    if (at < 0 || !normText(text)) return null;
    return headingAt.filter((h) => h.at <= at).sort((p, q) => q.at - p.at)[0]?.n ?? null;
  };

  // Typos and broken references the AI corrected while reading (skipping any already reported above).
  const reported = (o: string) => out.some((d) => d.code === "TYPO_OR_FORMAT" && normText(d.description).includes(normText(o)));
  for (const t of spec.typos) if (t.original && t.corrected && t.original !== t.corrected && !reported(t.original))
    add("TYPO_OR_FORMAT", "spec", sectionOf(t.original) ?? (t.section && t.section <= 12 ? t.section : 9), [], `"${t.original}" should read "${t.corrected}".`, `Corrected to "${t.corrected}".`);

  // Sections that the template has no place for.
  for (const s of spec.extra_sections) add("SECTION_NOT_IN_TEMPLATE", "spec", s.number && s.number <= 12 ? s.number : null, [], `Section "${s.heading}" is not part of the official template.`, "Left it out of the document and reported it here.");

  // Leftover template sample text inside the existing spec.
  const specNorm = normText(x.specText);
  const leftovers = templateSamples(model.template).filter((s) => s.length >= 12 && specNorm.includes(normText(s)));
  if (leftovers.length) add("PLACEHOLDER_TEXT", "template", null, [], `The spec still contains sample text from the template: "${leftovers[0].slice(0, 80)}"${leftovers.length > 1 ? ` and ${leftovers.length - 1} more` : ""}.`, "Replaced with this course's own content.");

  return out;
}

export type Check = { id: string; rule: string; pass: boolean; detail: string };

export function runChecks(m: SpecModel): Check[] {
  const ids = m.cos.map((c) => c.id);
  const mapIds = Object.keys(m.map).filter((k) => ids.includes(k));
  const covIds = Object.keys(m.assessment.coverage);
  const allCells = Object.entries(m.map).flatMap(([co, row]) => Object.entries(row).map(([col, cell]) => ({ co, col, ...cell })));
  const th = teachingHours(m);
  const weight = m.assessment.columns.reduce((a, c) => a + c.weight_percent, 0);
  const html = renderHtml(m, { watermark: false });
  const left = templateSamples(m.template).filter((s) => s.length >= 8 && html.includes(s));
  const badCeil = allCells.filter((c) => c.level > bloomCeiling(c.col, m.cos.find((x) => x.id === c.co)?.bloom ?? 6));
  const badPractical = allCells.filter((c) => c.col === "PO-5" && c.level >= 2 && !(m.assessment.coverage[c.co] ?? []).some(isPracticalOrAssignment));
  const extraIds = [...Object.keys(m.map), ...covIds].filter((k) => !ids.includes(k));
  return [
    { id: "V1", rule: "CO count is the same in Sections 3, 5 and 7", pass: mapIds.length === ids.length && ids.every((i) => covIds.includes(i)), detail: `${ids.length} COs; ${mapIds.length} map rows; ${ids.filter((i) => covIds.includes(i)).length} assessed rows` },
    { id: "V2", rule: "Every CO maps to at least one PO", pass: ids.every((i) => Object.keys(m.map[i] ?? {}).some((c) => c.startsWith("PO-"))), detail: ids.filter((i) => !Object.keys(m.map[i] ?? {}).some((c) => c.startsWith("PO-"))).join(", ") || "all mapped" },
    { id: "V3", rule: "Every CO is assessed in at least one component", pass: ids.every((i) => (m.assessment.coverage[i] ?? []).length > 0), detail: ids.filter((i) => !(m.assessment.coverage[i] ?? []).length).join(", ") || "all assessed" },
    { id: "V4", rule: "No undefined CO appears in any table", pass: extraIds.length === 0, detail: extraIds.join(", ") || "none" },
    { id: "V5", rule: "Teaching hours add up to the total", pass: th.total === m.teaching.groups.reduce((a, g) => a + g.hours, 0) && th.total > 0, detail: `${th.lectures} lectures + ${th.lab} lab + ${th.tests_exams} tests/exams, total ${th.total}` },
    { id: "V6", rule: "Assessment weightages total 100%", pass: Math.abs(weight - 100) < 0.5, detail: `${Math.round(weight * 100) / 100}%` },
    { id: "V7", rule: "No template sample text remains", pass: left.length === 0, detail: left.slice(0, 3).join(" | ") || "clean" },
    { id: "V8", rule: `PSO columns match the programme (${PSO_IDS.join(", ")})`, pass: allCells.every((c) => !c.col.startsWith("PSO") || PSO_IDS.includes(c.col)), detail: PSO_IDS.join(", ") },
    { id: "V9", rule: "Map values are 1-3, within Bloom's ceiling, strong PO-5 assessed practically", pass: !badCeil.length && !badPractical.length && allCells.every((c) => [1, 2, 3].includes(c.level)), detail: [...badCeil, ...badPractical].map((c) => `${c.co} ${c.col}`).join(", ") || "ok" },
    { id: "V10", rule: "Template matches the credit/course-type rule or has an override reason", pass: m.template === m.templateDetected || !!m.templateOverrideReason.trim(), detail: m.template === m.templateDetected ? m.templateSignals.join("; ") : `Override: ${m.templateOverrideReason || "(no reason)"}` },
  ];
}

export function severity(code: Defect["code"]): "High" | "Medium" | "Low" {
  if (/^CO_|PSO_|MAPPING_|WRONG_TEMPLATE/.test(code)) return "High";
  if (/HOURS|WEIGHTAGE|MARKS|SUMMARY|LABEL/.test(code)) return "Medium";
  return "Low";
}

