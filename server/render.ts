// Fills the official HTML templates (templates/*.html) with a SpecModel. Template structure, CSS and the
// "Download as PDF" button are kept; only the sample content is replaced.
import * as cheerio from "cheerio";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAP_COLUMNS, PO_IDS, PSO_IDS, type SpecModel, type Template } from "./model.js";

const FILES: Record<Template, string> = { integrated: "integrated_lab.html", non_lab: "non_lab.html" };
const cache: Partial<Record<Template, string>> = {};
const load = (t: Template) => (cache[t] ??= readFileSync(join(process.cwd(), "templates", FILES[t]), "utf8"));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The sample course text inside a template, collected when the template loads (used by validation rule V7).
export function templateSamples(t: Template): string[] {
  const $ = cheerio.load(load(t));
  const out = new Set<string>();
  const add = (s: string) => { s = s.replace(/\s+/g, " ").trim(); if (s.length >= 4) out.add(s); };
  add($("h1 span[contenteditable]").text());
  $("table").first().find("td[contenteditable]").each((_, el) => add($(el).text()));
  $("ul.co-list li, .unit-row span[contenteditable], ol li").each((_, el) => add($(el).text()));
  $("h2:contains('1. Course Summary')").next("p").each((_, el) => add($(el).text()));
  // Generic institutional phrases are shared by every course, so they are not "sample" text.
  return [...out].filter((s) => !/^(Engineering and Technology|Core|Class notes|Computer Science and Engineering)$/i.test(s) && !/^https?:\/\/(www\.)?(coursera|nptel)/i.test(s));
}

function h2(Section: string, $: cheerio.CheerioAPI) {
  return $("h2").filter((_, el) => $(el).text().trim().startsWith(Section)).first();
}

// Extra styling on top of the official template, for a cleaner printed document. Layout and sections are unchanged.
const POLISH = `
.page h1 { font-size: 13pt; letter-spacing: .2px; padding-bottom: 8px; border-bottom: 2px solid #1a3d7c; margin-bottom: 14px; }
.page h2 { color: #1a3d7c; border-bottom: 1px solid #c9d3e3; padding-bottom: 3px; margin-top: 1.8em; }
.page h3 { color: #1a3d7c; }
.page table thead th, .page table td.static[style*="bold"], .page table tr:first-child > td.static:first-child { background: #eef2f8; }
.page table { font-variant-numeric: tabular-nums; }
.copo-table thead th { font-size: 8.5pt; line-height: 1.25; vertical-align: middle; }
.copo-table td[data-l] { font-weight: 700; }
.copo-table td[data-l="1"] { background: #e2eaf6; } .copo-table td[data-l="2"] { background: #c2d3ec; } .copo-table td[data-l="3"] { background: #9db8e0; }
.unit-row { margin-bottom: 4px; }
.unit-row.lab-row { margin: 0 0 10px 52px; font-size: 9pt; color: #444; }
.unit-row.lab-row .unit-label { font-style: italic; font-weight: 600; }
ul.co-list li { margin-bottom: 4px; }
@media print {
  .page table thead th, .page table td.static[style*="bold"] { background: #eef2f8 !important; }
  .copo-table td[data-l="1"] { background: #e2eaf6 !important; } .copo-table td[data-l="2"] { background: #c2d3ec !important; } .copo-table td[data-l="3"] { background: #9db8e0 !important; }
  .page h1 { border-bottom: 2px solid #1a3d7c !important; } .page h2 { color: #1a3d7c !important; border-bottom: 1px solid #c9d3e3 !important; margin-top: 1.4em !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

// Shown until the HOD approves: a faint diagonal stamp plus a small notice at the top of the document.
const WATERMARK = `
body::after { content: "DRAFT"; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font: 700 110px Calibri, sans-serif; letter-spacing: 14px; color: rgba(0, 0, 0, .055); pointer-events: none; z-index: 999; }
.page::before { content: "DRAFT · not yet approved by the Head of Department"; display: block; text-align: center; font: 600 8pt Calibri, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; color: #b4532a; border: 1px solid #e8b9a6; background: #fdf3ee; padding: 4px; margin-bottom: 14px; }
@media print { body::after { position: fixed; } .page::before { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;

export function renderHtml(m: SpecModel, opts: { watermark: boolean }): string {
  const $ = cheerio.load(load(m.template));

  // Header
  $("h1 span[contenteditable]").text(m.header.title);
  const header: Record<string, string> = { "course title": m.header.title, "course code": m.header.code, "course type": m.header.course_type, department: m.header.department, faculty: m.header.faculty };
  $("table").first().find("tr").each((_, tr) => {
    const label = $(tr).find("td").first().text().trim().toLowerCase();
    if (label in header) $(tr).find("td").eq(1).text(header[label]);
  });

  // 1. Summary
  h2("1.", $).next("p").text(m.summary);

  // 2. Credits: fill each template row from the spec row with the same meaning.
  const creditsTable = h2("2.", $).next("table");
  creditsTable.find("tr").each((_, tr) => {
    const label = $(tr).find("td").first().text().trim();
    const key = label.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14);
    const src = m.credits.find((c) => c.label.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) === key);
    const cell = $(tr).find("td").eq(1);
    if (/structure/i.test(label)) cell.text(m.ltp);
    else cell.text(src?.value ?? "");
  });

  // 3. Course outcomes
  $("ul.co-list").html(m.cos.map((c) => `<li>${esc(c.statement)}</li>`).join("\n"));

  // 4. Course contents (+ lab exercises on the integrated template)
  const unitRows = $(".unit-row");
  const unitHtml = m.units.map((u) => {
    let s = `<div class="unit-row">\n<span class="static unit-label" style="padding: 1px 3px; border-radius: 2px;">Unit ${u.number}:</span> <span contenteditable="true">${esc(u.title)}${u.content ? ": " + esc(u.content) : ""}</span>\n</div>`;
    if (m.template === "integrated" && u.lab) s += `\n<div class="unit-row lab-row">\n<span class="static unit-label" style="padding: 1px 3px; border-radius: 2px;">Lab Exercises:</span> <span contenteditable="true">${esc(u.lab)}</span>\n</div>`;
    return s;
  }).join("\n");
  unitRows.first().before(unitHtml);
  unitRows.remove();

  // 5. CO-PO-PSO map
  const copo = $("table.copo-table");
  const legend = copo.find("tr.copo-legend-row").clone();
  copo.find("tbody").html(m.cos.map((c) => `<tr>\n<td class="text-center" contenteditable="true" style="font-weight:bold;">${c.id}</td>\n` +
    MAP_COLUMNS.map((col) => { const l = m.map[c.id]?.[col]?.level; return `<td class="text-center" contenteditable="true"${l ? ` data-l="${l}"` : ""}>${l ?? ""}</td>`; }).join("") + "\n</tr>").join("\n"));
  copo.find("tbody").append(legend);
  legend.find("td").attr("colspan", String(1 + PO_IDS.length + PSO_IDS.length));

  // 6. Teaching and learning methods: rows from the spec, total recomputed.
  const teach = h2("6.", $).next("table");
  const total = m.teaching.groups.reduce((a, g) => a + g.hours, 0);
  const two = (n: number) => String(n).padStart(2, "0");
  teach.find("tbody").html(m.teaching.groups.map((g) =>
    `<tr>\n<td colspan="2" class="static"><strong>${esc(g.name)}</strong></td>\n<td contenteditable="true">${two(g.hours)}</td>\n</tr>\n` +
    g.items.map((it) => `<tr>\n<td class="static" style="padding-left: 20px;">${esc(it.name)}</td>\n<td contenteditable="true">${two(it.hours)}</td>\n<td contenteditable="true"></td>\n</tr>`).join("\n")
  ).join("\n") + `\n<tr style="font-weight: bold;">\n<td class="static" style="font-weight: bold;">Total Duration in Hours</td>\n<td class="static"></td>\n<td contenteditable="true" style="font-weight: bold;">${two(total)}</td>\n</tr>`);

  // 7. Assessment: paragraphs from the spec, CO focus table rebuilt from its columns.
  const sec7 = h2("7.", $);
  const table7 = sec7.nextAll("table").first();
  const paraBefore = sec7.nextUntil("table").filter("p");
  const paraAfter = table7.nextUntil("h2").filter("p");
  if (m.assessment.before.length) { paraBefore.remove(); table7.before(m.assessment.before.map((p) => `<p contenteditable="true">${esc(p)}</p>`).join("\n")); }
  if (m.assessment.after.length) { paraAfter.remove(); table7.after(m.assessment.after.map((p) => `<p contenteditable="true">${esc(p)}</p>`).join("\n")); }
  const cols = m.assessment.columns;
  const n = cols.length;
  const groups = m.assessment.groups.map((g) => ({ ...g, span: cols.filter((c) => c.group.toLowerCase() === g.name.toLowerCase()).length })).filter((g) => g.span > 0);
  const th = (s: string, extra = "") => `<th class="static text-center"${extra}>${s}</th>`;
  table7.find("thead").html([
    `<tr>${th("Focus of COs on each Component or Subcomponent of Evaluation", ` colspan="${n + 1}"`)}</tr>`,
    `<tr>${th("Course<br>Outcome", ` rowspan="3" style="vertical-align: middle;"`)}${groups.map((g) => th(`${esc(g.name)}<br>(Weightage: ${g.weight_percent} %)`, g.span > 1 ? ` colspan="${g.span}"` : "")).join("")}</tr>`,
    `<tr>${cols.map((c) => th(esc(c.name))).join("")}</tr>`,
    `<tr>${cols.map((c) => th(esc(c.marks))).join("")}</tr>`,
  ].join("\n"));
  const note = table7.find("tbody tr").last().clone();
  note.find("td").attr("colspan", String(n + 1));
  table7.find("tbody").html(m.cos.map((c) => `<tr>\n<td class="static text-center" style="font-weight: bold;">${c.id}</td>\n` +
    cols.map((col) => `<td class="text-center" contenteditable="true">${(m.assessment.coverage[c.id] ?? []).includes(col.name) ? "X" : ""}</td>`).join("\n") + "\n</tr>").join("\n"));
  table7.find("tbody").append(note);

  // 8. Achieving COs
  if (m.skills.length) {
    h2("8.", $).nextAll("table").first().find("tbody").html(m.skills.map((s, i) =>
      `<tr><td class="static text-center">${i + 1}.</td><td class="static">${esc(s.skill)}</td><td class="static">${esc(s.how)}</td></tr>`).join("\n"));
  }

  // 9. Resources: the five lists in template order.
  const lists = h2("9.", $).next("div").find("ol");
  lists.each((i, ol) => {
    const items = m.resources[i]?.items ?? [];
    $(ol).html(items.length ? items.map((it) => `<li>${esc(it)}</li>`).join("\n") : "<li>--</li>");
  });

  $("title").text(`Course Specifications: ${m.header.title}`);
  $("head").append(`<style id="specforge-polish">${POLISH}</style>`);
  const footer = `${m.header.code} · Course Specifications: ${m.header.title}`.replace(/["\\]/g, "");
  $("head").append(`<style id="specforge-footer">@page { @bottom-left { content: "${footer}"; font: 8pt Calibri, sans-serif; color: #666; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Calibri, sans-serif; color: #666; } }</style>`);
  if (opts.watermark) $("head").append(`<style id="draft-watermark">${WATERMARK}</style>`);
  return $.html();
}
