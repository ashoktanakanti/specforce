// Turns an uploaded file (.docx, .doc, .pdf, .html) into plain text. Tables become "| a | b |" rows
// so the AI can still see which value sits in which column.
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { ApiError } from "./envelope.js";

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style").remove();
  // Lay each table out as a grid: a short merged header is repeated over every column it covers, and a cell that
  // spans rows leaves a blank below it, so values line up with the header above them.
  $("table").each((_, t) => {
    const left: number[] = []; // rows each column is still covered by a rowspan from an earlier row
    const rows = $(t).find("tr").map((_, tr) => {
      const out: string[] = [];
      let col = 0;
      const skipCovered = () => { while (left[col] > 0) { out.push(""); left[col]--; col++; } };
      $(tr).find("th, td").each((_, c) => {
        skipCovered();
        const text = $(c).text().replace(/\s+/g, " ").trim();
        const span = Math.max(1, Number($(c).attr("colspan")) || 1), rows = Math.max(1, Number($(c).attr("rowspan")) || 1);
        for (let k = 0; k < span; k++) { out.push(k === 0 || text.length <= 40 ? text : ""); if (rows > 1) left[col] = rows - 1; col++; }
      });
      skipCovered();
      return "| " + out.join(" | ") + " |";
    }).get();
    $(t).replaceWith(`\n${rows.join("\n")}\n`);
  });
  $("br").replaceWith("\n");
  $("p, li, h1, h2, h3, h4, h5, h6, div, tr").each((_, el) => { $(el).append("\n"); });
  return $.root().text().replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export async function extractText(name: string, buf: Buffer): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  try {
    let text = "";
    if (ext === "docx") text = htmlToText((await mammoth.convertToHtml({ buffer: buf })).value);
    else if (ext === "doc") text = (await new WordExtractor().extract(buf)).getBody();
    else if (ext === "pdf") text = (await pdfParse(buf)).text;
    else if (ext === "html" || ext === "htm") text = htmlToText(buf.toString("utf8"));
    else throw new ApiError(400, "UNSUPPORTED_FILE", `"${name}" is not a .docx, .doc, .pdf or .html file.`);
    text = text.replace(/\u0007/g, " | ").replace(/\r/g, "\n").trim();
    if (text.length < 40) throw new ApiError(400, "EMPTY_FILE", `Could not find any text in "${name}".`);
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "UNREADABLE_FILE", `Could not read "${name}". Is it a real ${ext} file?`);
  }
}
