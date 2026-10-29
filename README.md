# SpecForge

Upload a messy course specification (and its question-paper blueprint). SpecForge rebuilds it in the official
template, re-derives the CO-PO-PSO map with a one-line reason for every cell, lists every problem it found in the
inputs, and explains each Course Outcome in plain English so a student (or a new faculty member) gets it at a glance.
Author edits, Reviewer comments, HOD approves; the DRAFT watermark comes off only after approval.

## Run it

```bash
npm install
npm run dev          # web on http://localhost:5173, API on http://localhost:3001
```

Open the app, press **AI key**, pick Gemini or OpenRouter, paste your key, press **Test key**. Then drop the spec
(and blueprint) and press **Forge the spec**. Switch roles (Author / Reviewer / HOD) in the header.

Scoring check (app running, second terminal):

```bash
npm run verify -- gemini YOUR_KEY        # or: openrouter YOUR_KEY [model]
```

This saves `outputs/specforge_output.json` and `outputs/spec.html` and checks the file format.

## How it works

| Step | Where | How |
| --- | --- | --- |
| Read files | `server/extract.ts` | mammoth (.docx), word-extractor (.doc), pdf-parse (.pdf), cheerio (.html); tables kept as rows |
| Structure | `server/pipeline.ts` | AI turns the spec and blueprint into JSON, validated with Zod |
| Merge | `server/pipeline.ts` | Blueprint decides COs and units; everything else from the spec. Template picked from L:T:P / course type |
| Bloom's level | `server/model.ts` | Looked up in code from the CO's first verb (`config/po_pso.json`) |
| Map | `server/pipeline.ts` | AI proposes cells with reasons; code then enforces Bloom's ceilings, the PO-3/PO-5 assessment rule and PSO columns |
| Defects | `server/validate.ts` | Plain-code rules: CO tables, PSO columns, old map vs Bloom's, hours, weightages, marks, extra sections, leftover sample text, lab skills |
| Document | `server/render.ts` | Fills `templates/*.html` with cheerio; DRAFT watermark until approved |
| Workflow | `server/store.ts` | Draft → Submitted → Under Review → Pending HOD → Approved (+ Returned). Every permission checked on the server (403) |

API (all under `/api/v1`): `POST /generate` (scorer), `POST /specs`, `GET /specs`, `GET /specs/:id`,
`PATCH /specs/:id` (Author only, Draft/Returned), `POST /specs/:id/transition`, `POST /specs/:id/comments`,
`GET /specs/:id/spec.html`. Role is sent in the `x-role` header (seeded users, no login).

## Deploy on Vercel

Import the repo in Vercel; `vercel.json` builds the Vite app and serves the Express API from `api/index.ts`.
No environment variables are needed: users paste their own key in the app. Specs are kept in memory, so on
serverless they can disappear between requests; run locally for the full review workflow demo.

## AI tools used

- Claude (Anthropic) for writing the code
- Stitch (Google) for UI design exploration
- Gemini / OpenRouter models at runtime (bring your own key)

Track: coder track (own editor with AI help).

Keys are never stored on the server, logged, or committed.
