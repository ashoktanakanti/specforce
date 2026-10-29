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
  $("table").each((_, t) => {
    const rows = $(t).find("tr").map((_, tr) =>
      "| " + $(tr).find("th, td").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get().join(" | ") + " |").get();
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
