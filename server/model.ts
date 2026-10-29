// The working model of one course spec. Everything the app shows, edits, renders and exports comes from this.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const REF = JSON.parse(readFileSync(join(process.cwd(), "config", "po_pso.json"), "utf8")) as {
  pos: { id: string; title: string; statement: string }[];
  psos: { id: string; statement: string }[];
  blooms: { level: string; name: string; verbs: string }[];
};
export const PO_IDS = REF.pos.map((p) => p.id);
export const PSO_IDS = REF.psos.map((p) => p.id);
export const MAP_COLUMNS = [...PO_IDS, ...PSO_IDS];

export const DEFECT_CODES = ["CO_MISSING_IN_TABLE", "CO_EXTRA_IN_TABLE", "CO_ASSESSMENT_MISMATCH", "PSO_COLUMN_MISMATCH",
  "MAPPING_BLOOM_MISMATCH", "MAPPING_UNSUPPORTED", "WRONG_TEMPLATE", "PLACEHOLDER_TEXT", "SUMMARY_SYLLABUS_MISMATCH",
  "LABEL_OR_TITLE_MISMATCH", "HOURS_INCONSISTENT", "WEIGHTAGE_INCONSISTENT", "TYPO_OR_FORMAT", "SECTION_NOT_IN_TEMPLATE",
  "MARKS_INCONSISTENT", "OTHER"] as const;

export type Cell = { level: 1 | 2 | 3; justification: string };
export type Defect = {
  code: (typeof DEFECT_CODES)[number];
  location: { source: "spec" | "blueprint" | "template"; section: number | null; refs: string[] };
  description: string;
  fix: string;
};
export type Template = "integrated" | "non_lab";

export type SpecModel = {
  inputId: string;
  template: Template;
  templateDetected: Template;
  templateSignals: string[];
  templateOverrideReason: string;
  hasBlueprint: boolean;
  header: { title: string; code: string; course_type: string; department: string; faculty: string };
  summary: string;
  credits: { label: string; value: string }[];
  ltp: string;
  cos: { id: string; statement: string; bloom: number; plain: string; example: string }[];
  units: { number: number; title: string; content: string; hours: number | null; lab: string | null }[];
  map: Record<string, Record<string, Cell>>;
  teaching: { groups: { name: string; hours: number; items: { name: string; hours: number }[] }[] };
  assessment: {
    before: string[];
    after: string[];
    groups: { name: string; weight_percent: number }[];
    columns: { name: string; group: string; marks: string; weight_percent: number }[];
    coverage: Record<string, string[]>;
  };
  skills: { skill: string; how: string }[];
  resources: { heading: string; items: string[] }[];
  defects: Defect[];
};

// Bloom's level from the CO's first verb, using the verb list in config. Returns null if the verb is not listed.
export function bloomFromVerb(statement: string): number | null {
  const first = (statement.trim().match(/[A-Za-z]+/)?.[0] ?? "").toLowerCase();
  if (!first) return null;
  const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);
  for (const b of REF.blooms) {
    const verbs = b.verbs.replace(/\(.*?\)/g, "").split(",").map((v) => v.trim()).filter(Boolean);
    if (verbs.some((v) => stem(v) === stem(first))) return Number(b.level.replace(/\D/g, ""));
  }
  return null;
}

// The strongest value a CO of a given Bloom's level may carry for a PO (design/investigation need higher-order verbs).
export function bloomCeiling(col: string, bloom: number): number {
  if (col === "PO-3" || col === "PO-4") return bloom <= 2 ? 1 : bloom === 3 ? 2 : 3;
  if (col === "PO-2") return bloom <= 1 ? 1 : 3;
  return 3;
}

export const isPracticalOrAssignment = (component: string) => /lab|practical|assign|project|workshop|studio/i.test(component);

// The scoring file. Shape follows config/specforge_output.schema.json exactly.
export const OutputSchema = z.object({
  schema_version: z.literal("1.0"),
  input_id: z.string(),
  template: z.enum(["integrated", "non_lab"]),
  course: z.object({ title: z.string(), code: z.string(), department: z.string(), credits_ltp: z.string().regex(/^\d+:\d+:\d+$/), course_type: z.string(), summary: z.string() }).strict(),
  course_outcomes: z.array(z.object({ id: z.string().regex(/^CO-\d+$/), statement: z.string(), bloom_level: z.number().int().min(1).max(6) }).strict()).min(1),
  units: z.array(z.object({ number: z.number().int(), title: z.string(), lab: z.string().nullable() }).strict()),
  co_po_pso_map: z.record(z.record(z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), justification: z.string() }).strict())),
  teaching_hours: z.object({ lectures: z.number(), lab: z.number(), tests_exams: z.number(), total: z.number() }).strict(),
  assessment: z.object({
    components: z.array(z.object({ name: z.string(), weight_percent: z.number() }).strict()),
    co_coverage: z.record(z.array(z.string())),
  }).strict(),
  defects: z.array(z.object({
    code: z.enum(DEFECT_CODES),
    location: z.object({ source: z.enum(["spec", "blueprint", "template"]), section: z.number().int().min(1).max(12).nullable(), refs: z.array(z.string()) }).strict(),
    description: z.string(),
    fix: z.string(),
  }).strict()),
}).strict();
export type Output = z.infer<typeof OutputSchema>;

export function teachingHours(m: SpecModel) {
  const sumOf = (re: RegExp) => m.teaching.groups.filter((g) => re.test(g.name)).reduce((a, g) => a + g.hours, 0);
  return {
    lectures: sumOf(/lecture/i),
    lab: sumOf(/practical|laborator(y|ies)$|^lab/i),
    tests_exams: sumOf(/test|exam|mid ?term/i),
    // Contact hours: every teaching activity except tests and exams (which are listed separately).
    total: m.teaching.groups.filter((g) => !/test|exam|mid ?term/i.test(g.name)).reduce((a, g) => a + g.hours, 0),
  };
}

export function toOutput(m: SpecModel): Output {
  const map: Output["co_po_pso_map"] = {};
  for (const co of m.cos) map[co.id] = { ...(m.map[co.id] ?? {}) };
  return OutputSchema.parse({
    schema_version: "1.0",
    input_id: m.inputId,
    template: m.template,
    course: { title: m.header.title, code: m.header.code, department: m.header.department, credits_ltp: m.ltp, course_type: m.header.course_type, summary: m.summary },
    course_outcomes: m.cos.map((c) => ({ id: c.id, statement: c.statement, bloom_level: c.bloom })),
    units: m.units.map((u) => ({ number: u.number, title: u.title, lab: m.template === "integrated" ? u.lab : null })),
    co_po_pso_map: map,
    teaching_hours: teachingHours(m),
    assessment: {
      components: m.assessment.columns.map((c) => ({ name: c.name, weight_percent: c.weight_percent })),
      co_coverage: Object.fromEntries(m.cos.map((c) => [c.id, m.assessment.coverage[c.id] ?? []])),
    },
    defects: m.defects,
  });
}
