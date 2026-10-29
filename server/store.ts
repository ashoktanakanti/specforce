// In-memory specs and the approval workflow. Every permission is decided here, on the server.
import { randomUUID } from "node:crypto";
import { ApiError } from "./envelope.js";
import type { SpecModel } from "./model.js";

export type Role = "Author" | "Reviewer" | "HOD";
export type Status = "Draft" | "Submitted" | "Under Review" | "Pending HOD" | "Approved" | "Returned";
export type Action = "submit" | "start_review" | "forward" | "return" | "approve";

export const USERS: { email: string; name: string; role: Role }[] = [
  { email: "author@dept.example", name: "Course Author", role: "Author" },
  { email: "reviewer@dept.example", name: "Course Reviewer", role: "Reviewer" },
  { email: "hod@dept.example", name: "Head of Department", role: "HOD" },
];

export type LogEntry = { at: string; user: string; role: Role; action: string; from: Status | null; to: Status; comment: string };
export type Comment = { id: string; at: string; user: string; role: Role; section: string; text: string };
export type SpecRecord = { id: string; model: SpecModel; status: Status; log: LogEntry[]; comments: Comment[]; createdAt: string; updatedAt: string };

const specs = new Map<string, SpecRecord>();

// Which role may move a spec from which state, and where it goes.
const RULES: Record<Action, { role: Role[]; from: Status[]; to: Status; needsComment?: boolean }> = {
  submit: { role: ["Author"], from: ["Draft", "Returned"], to: "Submitted" },
  start_review: { role: ["Reviewer"], from: ["Submitted"], to: "Under Review" },
  forward: { role: ["Reviewer"], from: ["Submitted", "Under Review"], to: "Pending HOD" },
  return: { role: ["Reviewer", "HOD"], from: ["Submitted", "Under Review", "Pending HOD"], to: "Returned", needsComment: true },
  approve: { role: ["HOD"], from: ["Pending HOD"], to: "Approved" },
};

export function actor(roleHeader: unknown): { role: Role; user: string } {
  const role = String(roleHeader ?? "");
  const u = USERS.find((x) => x.role === role);
  if (!u) throw new ApiError(401, "NO_ROLE", "Pick a role (Author, Reviewer or HOD) first.");
  return { role: u.role, user: u.email };
}

export function create(model: SpecModel, by: { role: Role; user: string }): SpecRecord {
  if (by.role !== "Author") throw new ApiError(403, "FORBIDDEN", "Only the Author can create a spec.");
  const now = new Date().toISOString();
  const rec: SpecRecord = { id: randomUUID(), model, status: "Draft", log: [{ at: now, user: by.user, role: by.role, action: "create", from: null, to: "Draft", comment: "Generated from uploaded files" }], comments: [], createdAt: now, updatedAt: now };
  specs.set(rec.id, rec);
  return rec;
}

export const list = () => [...specs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function get(id: string): SpecRecord {
  const r = specs.get(id);
  if (!r) throw new ApiError(404, "NOT_FOUND", "No spec with that id.");
  return r;
}

export function assertCanEdit(rec: SpecRecord, by: { role: Role }) {
  if (by.role !== "Author") throw new ApiError(403, "FORBIDDEN", `A ${by.role} cannot edit content. Only the Author can.`);
  if (rec.status !== "Draft" && rec.status !== "Returned") throw new ApiError(403, "LOCKED", `The spec is "${rec.status}". The Author can edit only in Draft or Returned.`);
}

export function transition(rec: SpecRecord, action: Action, by: { role: Role; user: string }, comment = ""): SpecRecord {
  const rule = RULES[action];
  if (!rule) throw new ApiError(400, "BAD_ACTION", "Unknown action.");
  if (!rule.role.includes(by.role)) throw new ApiError(403, "FORBIDDEN", `A ${by.role} cannot ${action.replace("_", " ")}.`);
  if (!rule.from.includes(rec.status)) throw new ApiError(409, "BAD_STATE", `Cannot ${action.replace("_", " ")} a spec that is "${rec.status}".`);
  if (rule.needsComment && !comment.trim()) throw new ApiError(400, "COMMENT_REQUIRED", "Say why you are returning it.");
  const at = new Date().toISOString();
  rec.log.push({ at, user: by.user, role: by.role, action, from: rec.status, to: rule.to, comment: comment.trim() });
  rec.status = rule.to;
  rec.updatedAt = at;
  return rec;
}

export function addComment(rec: SpecRecord, by: { role: Role; user: string }, section: string, text: string): Comment {
  if (!text.trim()) throw new ApiError(400, "EMPTY_COMMENT", "Write a comment first.");
  if (rec.status === "Approved") throw new ApiError(409, "BAD_STATE", "The spec is approved; comments are closed.");
  const c: Comment = { id: randomUUID(), at: new Date().toISOString(), user: by.user, role: by.role, section, text: text.trim() };
  rec.comments.push(c);
  rec.updatedAt = c.at;
  return c;
}
