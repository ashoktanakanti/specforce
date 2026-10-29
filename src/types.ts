// Shapes of what the API returns (mirrors server/model.ts and server/store.ts).
export type Status = "Draft" | "Submitted" | "Under Review" | "Pending HOD" | "Approved" | "Returned";
export type Cell = { level: 1 | 2 | 3; justification: string };
export type Defect = {
  code: string; severity: "High" | "Medium" | "Low";
  location: { source: string; section: number | null; refs: string[] };
  description: string; fix: string;
};
export type Check = { id: string; rule: string; pass: boolean; detail: string };
export type SpecView = {
  id: string; status: Status; createdAt: string; updatedAt: string;
  log: { at: string; user: string; role: string; action: string; from: Status | null; to: Status; comment: string }[];
  comments: { id: string; at: string; user: string; role: string; section: string; text: string }[];
  model: {
    template: "integrated" | "non_lab"; templateDetected: "integrated" | "non_lab"; templateSignals: string[]; templateOverrideReason: string; hasBlueprint: boolean;
    header: { title: string; code: string; course_type: string; department: string; faculty: string };
    summary: string; ltp: string;
    cos: { id: string; statement: string; bloom: number; plain: string; example: string }[];
    units: { number: number; title: string; content: string; hours: number | null; lab: string | null }[];
    map: Record<string, Record<string, Cell>>;
  };
  output: unknown;
  checks: Check[];
  defects: Defect[];
  html: string;
};
export type SpecSummary = { id: string; title: string; code: string; status: Status; updatedAt: string };
export type Reference = { pos: { id: string; title: string; statement: string }[]; psos: { id: string; statement: string }[]; blooms: { level: string; name: string; verbs: string }[] };
