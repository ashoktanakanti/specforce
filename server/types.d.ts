// Minimal typings for two parser packages that ship without them.
declare module "word-extractor" {
  export default class WordExtractor { extract(input: Buffer | string): Promise<{ getBody(): string }>; }
}
declare module "pdf-parse/lib/pdf-parse.js" {
  export default function pdfParse(data: Buffer): Promise<{ text: string }>;
}
