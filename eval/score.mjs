// Golden-set eval for the Contract Analyzer pipeline.
//
// Usage:
//   WEBHOOK_URL=https://your-n8n-instance/webhook/xxxx node eval/score.mjs
//
// For each document in eval/golden-dataset/, uploads it to the live n8n webhook
// (the real deployed pipeline — not a mock), then scores the response against
// expected.json: exact contract-type match, party recall, and per-field key-term
// accuracy (case-insensitive substring match — the model's phrasing won't match
// the golden text verbatim, so this checks whether the expected value is
// findable inside what the model returned, not string equality).
//
// Writes a JSON report to eval/report.json and prints a summary table.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(__dirname, "golden-dataset");
const expected = JSON.parse(readFileSync(path.join(goldenDir, "expected.json"), "utf-8"));

const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) {
  console.error("Set WEBHOOK_URL to your published n8n webhook before running this.");
  process.exit(1);
}

function normalize(str) {
  return String(str ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fuzzyContains(haystack, needle) {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n) return false;
  // A hit if either fully contains the other, or they share a solid word overlap —
  // exact substring is too strict once the model paraphrases dates/amounts.
  if (h.includes(n) || n.includes(h)) return true;
  const needleWords = n.split(" ").filter((w) => w.length > 2);
  if (needleWords.length === 0) return false;
  const hits = needleWords.filter((w) => h.includes(w)).length;
  return hits / needleWords.length >= 0.6;
}

async function analyzeDocument(pdfPath) {
  const buf = readFileSync(pdfPath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "application/pdf" }), path.basename(pdfPath));
  form.append("intent", "extract key terms");
  form.append("file_name", path.basename(pdfPath));

  const res = await fetch(WEBHOOK_URL, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || data.valid === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function scoreDocument(docId, actual, expectedDoc) {
  const result = {
    docId,
    contractTypeCorrect: actual.contract_type === expectedDoc.contract_type,
    parties: { expected: expectedDoc.parties, found: [], missing: [] },
    fields: {},
  };

  for (const party of expectedDoc.parties) {
    const found = (actual.parties || []).some((p) => fuzzyContains(p, party));
    (found ? result.parties.found : result.parties.missing).push(party);
  }

  const actualTermsByLabel = new Map();
  for (const term of actual.key_terms || []) {
    const key = normalize(term.label ?? "");
    actualTermsByLabel.set(key, term.value ?? "");
  }

  for (const [fieldKey, expectedValue] of Object.entries(expectedDoc.key_terms)) {
    // Match loosely on label text since the model returns key_term_label, not key_term_name.
    let matchedValue = null;
    for (const [label, value] of actualTermsByLabel.entries()) {
      if (label.includes(fieldKey.replace(/_/g, " ")) || fieldKey.replace(/_/g, " ").includes(label)) {
        matchedValue = value;
        break;
      }
    }
    const pass = matchedValue != null && fuzzyContains(matchedValue, expectedValue);
    result.fields[fieldKey] = { expected: expectedValue, actual: matchedValue, pass };
  }

  const fieldResults = Object.values(result.fields);
  result.fieldAccuracy = fieldResults.length
    ? fieldResults.filter((f) => f.pass).length / fieldResults.length
    : 0;
  result.partyRecall = expectedDoc.parties.length
    ? result.parties.found.length / expectedDoc.parties.length
    : 1;

  return result;
}

async function main() {
  const pdfFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".pdf"));
  const results = [];

  for (const file of pdfFiles) {
    const docId = file.replace(/\.pdf$/, "");
    const expectedDoc = expected[docId];
    if (!expectedDoc) {
      console.warn(`No expected answer for ${docId}, skipping.`);
      continue;
    }

    process.stdout.write(`Analyzing ${file}... `);
    try {
      const actual = await analyzeDocument(path.join(goldenDir, file));
      const scored = scoreDocument(docId, actual, expectedDoc);
      results.push(scored);
      console.log(
        `contract_type ${scored.contractTypeCorrect ? "OK" : "MISS"}, ` +
        `parties ${(scored.partyRecall * 100).toFixed(0)}%, ` +
        `fields ${(scored.fieldAccuracy * 100).toFixed(0)}%`
      );
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ docId, error: err.message });
    }
  }

  const scored = results.filter((r) => !r.error);
  const overall = {
    documentsRun: results.length,
    documentsErrored: results.length - scored.length,
    contractTypeAccuracy: scored.length
      ? scored.filter((r) => r.contractTypeCorrect).length / scored.length
      : 0,
    avgPartyRecall: scored.length
      ? scored.reduce((sum, r) => sum + r.partyRecall, 0) / scored.length
      : 0,
    avgFieldAccuracy: scored.length
      ? scored.reduce((sum, r) => sum + r.fieldAccuracy, 0) / scored.length
      : 0,
  };

  console.log("\n--- Summary ---");
  console.log(`Contract type accuracy: ${(overall.contractTypeAccuracy * 100).toFixed(0)}%`);
  console.log(`Avg. party recall:      ${(overall.avgPartyRecall * 100).toFixed(0)}%`);
  console.log(`Avg. field accuracy:    ${(overall.avgFieldAccuracy * 100).toFixed(0)}%`);

  writeFileSync(
    path.join(__dirname, "report.json"),
    JSON.stringify({ overall, results, ranAt: new Date().toISOString() }, null, 2)
  );
  console.log("\nFull report written to eval/report.json");
}

main();
