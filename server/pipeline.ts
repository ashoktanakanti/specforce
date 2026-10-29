// The whole pipeline: files -> text -> structured data (AI) -> merge by source-of-truth rules -> CO-PO-PSO map (AI + rules)
// -> defects (plain code) -> SpecModel. No course content lives here: everything comes from the uploaded files.
import { z, type ZodType } from "zod";
import { extractText } from "./extract.js";
import { MAP_COLUMNS, PO_IDS, REF, bloomCeiling, bloomFromVerb, isPracticalOrAssignment, type Cell, type SpecModel, type Template } from "./model.js";
import { findDefects } from "./validate.js";

export type Ai = <T>(prompt: string, schema: ZodType<T, any, any>) => Promise<T>;
export type UploadedFile = { name: string; buf: Buffer };

// Lenient field helpers: models sometimes send numbers as strings or leave fields null.
const str = z.any().transform((v) => (v == null ? "" : String(v).trim()));
const num = z.any().transform((v) => { const x = Number(String(v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(x) ? x : 0; });
const numOrNull = z.any().transform((v) => { if (v == null || v === "") return null; const x = Number(String(v).replace(/[^\d.]/g, "")); return Number.isFinite(x) ? x : null; });
const strList = z.array(z.any()).catch([]).transform((a) => a.map((x) => String(x ?? "").trim()).filter(Boolean));
const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).catch([]);

const SpecSchema = z.object({
  title: str, code: str, course_type: str, department: str, faculty: str, summary: str,
  credits: list(z.object({ label: str, value: str })),
  ltp: str,
  cos: z.array(z.object({ id: str, statement: str })).min(1),
  units: list(z.object({ number: num, title: str, content: str, hours: numOrNull, lab: z.any().transform((v) => (v ? String(v).trim() : null)) })),
  old_map: z.object({ columns: strList, rows: list(z.object({ co: str, values: z.record(z.any()).catch({}) })) }).catch({ columns: [], rows: [] }),
  teaching: z.object({ groups: list(z.object({ name: str, hours: num, items: list(z.object({ name: str, hours: num })) })), stated_total: numOrNull })
    .catch({ groups: [], stated_total: null }),
  assessment: z.object({
    before: strList, after: strList,
    groups: list(z.object({ name: str, weight_percent: num })),
    columns: list(z.object({ name: str, group: str, marks: str })),
    rows: list(z.object({ co: str, components: strList })),
  }).catch({ before: [], after: [], groups: [], columns: [], rows: [] }),
  skills: list(z.object({ skill: str, how: str })),
  resources: list(z.object({ heading: str, items: strList })),
  extra_sections: list(z.object({ heading: str, number: numOrNull })),
  typos: list(z.object({ section: numOrNull, original: str, corrected: str })),
});
export type SpecDoc = z.infer<typeof SpecSchema>;

const BlueprintSchema = z.object({
  title: str, code: str, max_marks: numOrNull,
  cos: list(z.object({ id: str, statement: str })),
  units: list(z.object({ number: num, title: str, content: str, hours: numOrNull, marks: numOrNull })),
});
export type BlueprintDoc = z.infer<typeof BlueprintSchema>;

const MapSchema = z.object({
  summary: str,
  summary_matches_syllabus: z.any().transform((v) => v !== false && v !== "false"),
  summary_missing_themes: strList,
  cos: list(z.object({ id: str, plain: str, example: str })),
  map: list(z.object({ co: str, cells: list(z.object({ col: str, level: num, why: str })) })),
});

const SPEC_PROMPT = (text: string) => `You read a university course specification and return its content as JSON. Copy text exactly as written (do not fix it), except where told.
Return this JSON shape:
{
 "title","code","course_type","department","faculty": strings from the header table,
 "summary": the Course Summary paragraph,
 "credits": [{"label","value"}] every row of the "Course Size and Credits" table, in order,
 "ltp": the credit structure as L:T:P digits, e.g. "3:0:1",
 "cos": [{"id":"CO-1","statement"}] the Course Outcomes listed in the Course Outcomes section (normalise ids to CO-n),
 "units": [{"number","title","content","hours","lab"}] each unit: title is the short unit name (e.g. text in brackets or before the first colon), content is the full unit text, hours if given else null, lab is that unit's lab exercise text or null,
 "old_map": {"columns": every column header of the CO-PO-PSO map table (e.g. "PO-1".."PSO-3"), "rows": [{"co":"CO-1","values":{"PO-1":3,...}}] one per CO row in the map, blank cells omitted},
 "teaching": {"groups":[{"name","hours","items":[{"name","hours"}]}], "stated_total"} from the teaching and learning methods table: each bold/top-level row is a group with its total hours, numbered sub-rows are items; stated_total is the "Total Duration in Hours" value,
 "assessment": {"before": [paragraphs before the CO focus table], "after": [paragraphs after it], "groups": [{"name":"CE","weight_percent":60}] the top header groups with their weightage, "columns": [{"name","group","marks"}] each assessed sub-column, the group it sits under, and its marks text, "rows": [{"co":"CO-1","components":[names of columns marked X]}] one per CO row},
 "skills": [{"skill","how"}] rows of the Achieving COs table,
 "resources": [{"heading","items"}] the resource lists in order (Essential Reading, Recommended Reading, Magazines and Journals, Websites, Other Electronic Resources); in items, rejoin entries broken across lines, correct obvious typos in author names, publisher names and URLs, and strip stray list numbering,
 "extra_sections": [{"heading","number"}] any top-level section that is NOT one of: Course Summary, Course Size and Credits, Course Outcomes, Course Contents, Course Map, Teaching and Learning Methods, Assessment and Reassessment, Achieving COs, Course Resources. number is its position counting the nine above as 1-9 (so the next one is 10),
 "typos": [{"section","original","corrected"}] every spelling mistake or broken reference/URL you corrected in resources or found elsewhere, with the section number (1-9) where it is. Only real errors.
}

DOCUMENT:
"""
${text}
"""`;

const BLUEPRINT_PROMPT = (text: string) => `You read a question-paper blueprint for a university course and return JSON. Copy text exactly.
{"title","code","max_marks": the stated maximum marks (number or null),
 "cos":[{"id":"CO-1","statement"}] the Course Outcomes (normalise ids to CO-n),
 "units":[{"number","title","content","hours","marks"}] one per unit row: title is the short unit name before the first colon, content is the topic text after it, hours and marks as numbers or null}

DOCUMENT:
"""
${text}
"""`;

const MAP_PROMPT = (ctx: object) => `You are an NBA accreditation expert building the CO-PO-PSO map of a course, with plain-English help for students.

Programme Outcomes and PSOs:
${[...REF.pos.map((p) => `${p.id} (${p.title}): ${p.statement}`), ...REF.psos.map((p) => `${p.id}: ${p.statement}`)].join("\n")}

Course data (Bloom's levels are already fixed, do not change them):
${JSON.stringify(ctx, null, 1)}

Mapping rules (follow strictly, then re-check every cell against them before answering):
- Scale: 3 very strong, 2 strong, 1 moderate. Leave a cell out when there is no real link. Columns allowed: ${MAP_COLUMNS.join(", ")}.
- Every CO maps to at least one PO.
- A CO cannot map more strongly than its Bloom's level supports: L1-L2 outcomes (remember/explain) map to PO-3 and PO-4 at most 1; L3 (apply) at most 2; strong design (PO-3 = 3) needs a Create or Evaluate-level outcome.
- PO-5 needs real tool use (lab work or programming) for that CO.
- PO-6, PO-7, PO-8, PO-9 and PO-10 need explicit evidence in the syllabus or assessment (e.g. teamwork, presentations, ethics, project management). No evidence means leave them out.
- A CO mapped 2 or 3 to PO-3 or PO-5 must be assessed in a practical or assignment component (see coverage).
- PSOs: rate how directly the CO builds the PSO.
- Each filled cell has a one-line justification that cites the CO's verb and the syllabus or assessment evidence.

Also:
- "summary": rewrite the course summary (one paragraph, 70-120 words, same formal tone) so it covers the theme of every unit, starting from the original summary.
- "summary_matches_syllabus": false if the ORIGINAL summary leaves out the main theme of one or more units; list them in "summary_missing_themes".
- "cos": for each CO, "plain": the outcome rewritten in simple everyday English a first-year student instantly understands (one sentence, no jargon, start with "You will"), and "example": one concrete thing the student will actually do (one short sentence).

Return JSON: {"summary","summary_matches_syllabus","summary_missing_themes":[],"cos":[{"id","plain","example"}],"map":[{"co":"CO-1","cells":[{"col":"PO-1","level":3,"why":"..."}]}]}`;

const normCo = (id: string) => { const n = id.match(/\d+/)?.[0]; return n ? `CO-${Number(n)}` : id.trim(); };
const normLtp = (s: string) => { const d = s.match(/\d+/g); return d && d.length >= 3 ? d.slice(0, 3).map(Number).join(":") : "0:0:0"; };

export function detectTemplate(ltp: string, courseType: string): { template: Template; signals: string[] } {
  const practical = Number(ltp.split(":")[2] ?? 0);
  const signals: string[] = [];
  if (practical > 0) signals.push(`Credit structure ${ltp} has a non-zero Practical value`);
  else signals.push(`Credit structure ${ltp} has no Practical value`);
  if (/laborator|\blab\b|practical/i.test(courseType)) signals.push(`Course type "${courseType}" mentions a laboratory`);
  const lab = practical > 0 || /laborator|\blab\b|practical/i.test(courseType);
  return { template: lab ? "integrated" : "non_lab", signals };
}

export async function runPipeline(files: { spec: UploadedFile; blueprint?: UploadedFile }, ai: Ai, inputId = "SAMPLE"): Promise<SpecModel> {
  const specText = await extractText(files.spec.name, files.spec.buf);
  const bpText = files.blueprint ? await extractText(files.blueprint.name, files.blueprint.buf) : null;

  const [spec, bp] = await Promise.all([
    ai(SPEC_PROMPT(specText), SpecSchema),
    bpText ? ai(BLUEPRINT_PROMPT(bpText), BlueprintSchema) : Promise.resolve(null),
  ]);
  spec.cos = spec.cos.map((c) => ({ ...c, id: normCo(c.id) }));
  if (bp) bp.cos = bp.cos.map((c) => ({ ...c, id: normCo(c.id) }));
  const useBp = !!bp && bp.cos.length > 0;

  // Source of truth: COs and unit text from the blueprint when there is one, everything else from the spec.
  const ltp = normLtp(spec.ltp || spec.credits.find((c) => /structure|L\s*:\s*T/i.test(c.label))?.value || "");
  const { template, signals } = detectTemplate(ltp, spec.course_type);
  const cosSrc = useBp ? bp!.cos : spec.cos;
  const cos = cosSrc.map((c) => ({ id: c.id, statement: c.statement, bloom: bloomFromVerb(c.statement) ?? 3, plain: "", example: "" }));
  const unitsSrc = useBp && bp!.units.length ? bp!.units : spec.units;
  const units = unitsSrc.map((u, i) => {
    const number = u.number || i + 1;
    const specUnit = spec.units.find((s) => s.number === number) ?? spec.units[i];
    return { number, title: u.title, content: u.content, hours: u.hours ?? specUnit?.hours ?? null, lab: specUnit?.lab ?? null };
  });

  // Assessment: drop CO rows that are not defined, split group weightage across its columns by marks.
  const coIds = new Set(cos.map((c) => c.id));
  const coverage: Record<string, string[]> = {};
  for (const r of spec.assessment.rows) { const id = normCo(r.co); if (coIds.has(id)) coverage[id] = r.components; }
  const marksOf = (m: string) => Number(m.match(/\d+(\.\d+)?/)?.[0] ?? 0);
  const columns = spec.assessment.columns.map((c) => {
    const g = spec.assessment.groups.find((g) => g.name.toLowerCase() === c.group.toLowerCase());
    const peers = spec.assessment.columns.filter((p) => p.group.toLowerCase() === c.group.toLowerCase());
    const totalMarks = peers.reduce((a, p) => a + marksOf(p.marks), 0);
    const share = g ? (totalMarks ? (g.weight_percent * marksOf(c.marks)) / totalMarks : g.weight_percent / peers.length) : 0;
    return { ...c, weight_percent: Math.round(share * 100) / 100 };
  });
  // Keep each group's columns side by side so the table header lines up.
  const groupIdx = (c: { group: string }) => { const i = spec.assessment.groups.findIndex((g) => g.name.toLowerCase() === c.group.toLowerCase()); return i < 0 ? 99 : i; };
  columns.sort((a, b) => groupIdx(a) - groupIdx(b));

  const model: SpecModel = {
    inputId, template, templateDetected: template, templateSignals: signals, templateOverrideReason: "", hasBlueprint: useBp,
    header: { title: spec.title || bp?.title || "", code: spec.code || bp?.code || "", course_type: spec.course_type, department: spec.department, faculty: spec.faculty },
    summary: spec.summary,
    credits: spec.credits, ltp, cos, units,
    map: {},
    teaching: { groups: spec.teaching.groups },
    assessment: { before: spec.assessment.before, after: spec.assessment.after, groups: spec.assessment.groups, columns, coverage },
    skills: spec.skills,
    resources: spec.resources,
    defects: [],
  };

  // CO-PO-PSO map, simpler CO wording and the revised summary.
  const mapped = await ai(MAP_PROMPT({
    course: model.header.title, credits_ltp: ltp, has_lab: template === "integrated",
    original_summary: spec.summary,
    course_outcomes: cos.map((c) => ({ id: c.id, statement: c.statement, bloom_level: c.bloom, assessed_in: coverage[c.id] ?? [] })),
    units: units.map((u) => ({ number: u.number, title: u.title, content: u.content, lab: u.lab })),
    assessment_components: columns.map((c) => c.name),
    skills_table: spec.skills,
  }), MapSchema);

  if (mapped.summary) model.summary = mapped.summary;
  for (const c of model.cos) {
    const p = mapped.cos.find((x) => normCo(x.id) === c.id);
    c.plain = p?.plain ?? ""; c.example = p?.example ?? "";
  }
  for (const c of cos) {
    const row: Record<string, Cell> = {};
    const aiRow = mapped.map.find((r) => normCo(r.co) === c.id);
    for (const cell of aiRow?.cells ?? []) {
      const col = cell.col.toUpperCase().replace(/\s/g, "").replace(/^(PSO|PO)-?(\d+)$/, "$1-$2");
      if (!MAP_COLUMNS.includes(col)) continue;
      let level = Math.max(0, Math.min(3, Math.round(cell.level)));
      level = Math.min(level, bloomCeiling(col, c.bloom));
      if ((col === "PO-3" || col === "PO-5") && level >= 2 && !(coverage[c.id] ?? []).some(isPracticalOrAssignment)) level = 1;
      if (level >= 1) row[col] = { level: level as 1 | 2 | 3, justification: cell.why || `${c.id} supports ${col}.` };
    }
    if (!PO_IDS.some((p) => row[p])) row["PO-1"] = { level: 1, justification: `${c.id} draws on the engineering and computing fundamentals of the course.` };
    model.map[c.id] = row;
  }

  model.defects = findDefects({ spec, bp, model, specText, summaryOk: mapped.summary_matches_syllabus, missingThemes: mapped.summary_missing_themes });
  return model;
}

