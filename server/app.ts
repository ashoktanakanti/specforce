import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { ApiError, fail, ok } from "./envelope.js";
import { configFromRequest, generateJson } from "./llm.js";
import { MAP_COLUMNS, REF, toOutput, type SpecModel } from "./model.js";
import { runPipeline, type Ai } from "./pipeline.js";
import { renderHtml } from "./render.js";
import * as store from "./store.js";
import { runChecks, severity } from "./validate.js";

export const app = express();
app.use(express.json({ limit: "10mb" }));
const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

function filesFrom(req: Request) {
  const f = req.files as Record<string, Express.Multer.File[]> | undefined;
  const spec = f?.spec?.[0];
  if (!spec) throw new ApiError(400, "MISSING_SPEC", "Upload the existing course specification (field 'spec').");
  const bp = f?.blueprint?.[0];
  return { spec: { name: spec.originalname, buf: spec.buffer }, blueprint: bp ? { name: bp.originalname, buf: bp.buffer } : undefined };
}
const aiFor = (req: Request): Ai => { const cfg = configFromRequest(req); return (prompt, schema) => generateJson(prompt, schema, cfg); };
const inputIdOf = (req: Request) => String(req.body?.input_id ?? "").trim() || "SAMPLE";

api.get("/health", (_req, res) => ok(res, { status: "up" }));
api.get("/users", (_req, res) => ok(res, store.USERS));
api.get("/reference", (_req, res) => ok(res, REF));

// "Test key" button in Settings.
api.get("/llm-check", wrap(async (req, res) => {
  const cfg = configFromRequest(req);
  const out = await generateJson('Return exactly {"pong": true}', z.object({ pong: z.boolean() }), cfg);
  ok(res, { provider: cfg.provider, model: cfg.model, reply: out });
}));

// The scorer's route: files in, { output, html } out, no clicks.
api.post("/generate", upload.fields([{ name: "spec", maxCount: 1 }, { name: "blueprint", maxCount: 1 }]), wrap(async (req, res) => {
  const model = await runPipeline(filesFrom(req), aiFor(req), inputIdOf(req));
  ok(res, { output: toOutput(model), html: renderHtml(model, { watermark: true }) });
}));

// ---- Specs and workflow (the app's own screens) ----
const view = (r: store.SpecRecord) => ({
  id: r.id, status: r.status, log: r.log, comments: r.comments, createdAt: r.createdAt, updatedAt: r.updatedAt,
  model: r.model,
  output: toOutput(r.model),
  checks: runChecks(r.model),
  defects: r.model.defects.map((d) => ({ ...d, severity: severity(d.code) })),
  html: renderHtml(r.model, { watermark: r.status !== "Approved" }),
});

api.get("/specs", (_req, res) => ok(res, store.list().map((r) => ({ id: r.id, title: r.model.header.title, code: r.model.header.code, status: r.status, updatedAt: r.updatedAt }))));

api.post("/specs", upload.fields([{ name: "spec", maxCount: 1 }, { name: "blueprint", maxCount: 1 }]), wrap(async (req, res) => {
  const by = store.actor(req.header("x-role"));
  if (by.role !== "Author") throw new ApiError(403, "FORBIDDEN", "Only the Author can upload and generate a spec.");
  const model = await runPipeline(filesFrom(req), aiFor(req), inputIdOf(req));
  ok(res, view(store.create(model, by)), 201);
}));

api.get("/specs/:id", (req, res) => ok(res, view(store.get(req.params.id))));

api.get("/specs/:id/spec.html", (req, res) => {
  const r = store.get(req.params.id);
  res.type("html").send(renderHtml(r.model, { watermark: r.status !== "Approved" }));
});

const Level = z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]);
const Patch = z.object({
  summary: z.string().optional(),
  cos: z.array(z.object({ id: z.string(), statement: z.string().optional(), plain: z.string().optional(), bloom: z.number().int().min(1).max(6).optional() })).optional(),
  units: z.array(z.object({ number: z.number(), title: z.string().optional(), content: z.string().optional(), lab: z.string().nullable().optional() })).optional(),
  map: z.record(z.record(z.union([Level, z.object({ level: Level, justification: z.string() })]))).optional(),
  template: z.enum(["integrated", "non_lab"]).optional(),
  templateOverrideReason: z.string().optional(),
}).strict();

api.patch("/specs/:id", (req, res) => {
  const by = store.actor(req.header("x-role"));
  const r = store.get(req.params.id);
  store.assertCanEdit(r, by);
  const p = Patch.safeParse(req.body);
  if (!p.success) throw new ApiError(400, "BAD_INPUT", p.error.issues[0]?.message ?? "Invalid edit.");
  const m: SpecModel = r.model, b = p.data;
  if (b.summary !== undefined) m.summary = b.summary;
  for (const c of b.cos ?? []) { const t = m.cos.find((x) => x.id === c.id); if (t) Object.assign(t, { ...c, id: t.id }); }
  for (const u of b.units ?? []) { const t = m.units.find((x) => x.number === u.number); if (t) Object.assign(t, { ...u, number: t.number }); }
  for (const [co, row] of Object.entries(b.map ?? {})) {
    if (!m.cos.some((c) => c.id === co)) throw new ApiError(400, "BAD_CO", `${co} is not a Course Outcome.`);
    for (const [col, v] of Object.entries(row)) {
      if (!MAP_COLUMNS.includes(col)) throw new ApiError(400, "BAD_COLUMN", `${col} is not a map column.`);
      const level = v && typeof v === "object" ? v.level : v;
      m.map[co] ??= {};
      if (level == null) delete m.map[co][col];
      else m.map[co][col] = { level, justification: (v && typeof v === "object" ? v.justification : m.map[co][col]?.justification) || "Set by the Author." };
    }
  }
  if (b.template && b.template !== m.template) {
    if (b.template !== m.templateDetected && !b.templateOverrideReason?.trim()) throw new ApiError(400, "REASON_REQUIRED", "Give a reason for overriding the detected template.");
    m.template = b.template;
    m.templateOverrideReason = b.template === m.templateDetected ? "" : b.templateOverrideReason!.trim();
  }
  r.updatedAt = new Date().toISOString();
  r.log.push({ at: r.updatedAt, user: by.user, role: by.role, action: "edit", from: r.status, to: r.status, comment: Object.keys(b).join(", ") });
  ok(res, view(r));
});

api.post("/specs/:id/transition", (req, res) => {
  const by = store.actor(req.header("x-role"));
  const body = z.object({ action: z.enum(["submit", "start_review", "forward", "return", "approve"]), comment: z.string().optional() }).safeParse(req.body);
  if (!body.success) throw new ApiError(400, "BAD_INPUT", "Send { action, comment }.");
  ok(res, view(store.transition(store.get(req.params.id), body.data.action, by, body.data.comment)));
});

api.post("/specs/:id/comments", (req, res) => {
  const by = store.actor(req.header("x-role"));
  const body = z.object({ section: z.string().min(1), text: z.string() }).safeParse(req.body);
  if (!body.success) throw new ApiError(400, "BAD_INPUT", "Send { section, text }.");
  const r = store.get(req.params.id);
  store.addComment(r, by, body.data.section, body.data.text);
  ok(res, view(r), 201);
});

app.use("/api/v1", api);
app.use("/api", (_req, res) => fail(res, 404, "NOT_FOUND", "No such route"));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) return fail(res, err.status, err.code, err.message);
  if (err instanceof multer.MulterError) return fail(res, 400, "BAD_UPLOAD", err.message);
  console.error("Unhandled:", err instanceof Error ? err.message : "unknown error"); // never log headers or keys
  fail(res, 500, "SERVER_ERROR", "Something went wrong on the server.");
});
