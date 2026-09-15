# Document Intelligence (practice build)

A lightweight document-extraction demo built to prepare for an AI PM interview at
BoundAI/OIP Insurtech. Based on the free `pm-end-to-end-build` lab (n8n + Claude
Code + Supabase), adapted: Netlify → **Vercel**, OpenAI → **Claude**, generic
contracts → real insurance submission document types, plus real error handling,
input validation, observability, and an eval harness the original lab didn't have.

The frontend is three screens (per the original lab's mockup prompt), not a
marketing landing page: **Upload Document**, **Analysis Results**, **Playbook** —
navigated via a sidebar, styled like the inside of a product rather than a
website.

## Document-type pivot: from generic contracts to real insurance submissions

This build originally used NDA/MSA/Lease contracts (see [docs/prd-lease-compliance-2026-03-31.md](docs/prd-lease-compliance-2026-03-31.md)
for that earlier direction, now superseded). That was a mistake worth naming
plainly rather than quietly fixing: "I only had access to lease/NDA/MSA
contracts, not real insurance documents" is not a credible excuse when
presenting to an insurance company, given the entire pipeline was built by
synthesizing documents with the same tool in the first place. If synthesis is
good enough to build the demo, it's good enough to make the demo's documents
match the actual domain.

Current documents (all synthetic, bundled as one realistic submission package
for a single fictional insured — "Ridgeline Roofing & Construction LLC" — since
that's how real underwriting submissions actually arrive together, not as
disconnected single files):
- **ACORD 125-style Commercial Insurance Application**
- **Statement of Values (SOV)**
- **Loss Run Report**

The architecture underneath — playbook-driven extraction, citations, the
risk-weight × confidence human-review gate — didn't change at all. Only the
documents, the playbook rows, and the Orchestrator's document-type-detection
prompt changed. That's itself worth saying out loud in the interview: the
system was designed so that swapping domains is a data change, not an
architecture change.

**Still deliberately not built**, to keep this a portfolio piece rather than a
real product: email delivery of results (needs a real email-sending credential
— new infrastructure, not a data change), and the appetite-match / OFAC /
duplicate-detection validation engine BoundAI's actual "Document Intelligence"
and "Document AI" products run (each is its own rules engine against data this
demo doesn't have — carrier appetite tables, sanctions lists, a submission
history to de-dupe against). Both are "here's what I'd build next" talking
points, same treatment as the risk-scoring agent and tiered models below.

## Architecture

```
Browser (static HTML/CSS/JS on Vercel)
  → POST multipart/form-data → n8n Webhook
      → Validate Input (file type/size/intent)
      → Extract from File (PDF text)
      → GATE 1: Sanity Check Extraction (garbled/empty text?) → if bad, 422 now, before any LLM call
      → Orchestrator Agent (Claude) — intent + contract-type detection only
          → contract_playbook_agent → Supabase (contract_playbook)
      → Attach Contract Text → Prepare N Extraction Requests (N=3)
      → Extract Key Terms (Run N) × 3 — direct Anthropic API calls, temperature 0.7,
        run independently and in parallel (self-consistency voting, not an agent tool)
      → Aggregate Self-Consistency Votes — majority value per playbook field,
        agreement fraction as confidence (e.g. "3/3", "2/3")
      → Parse Result
          → GATE 2: needs_human_review = (high risk_weight term with no citation)
                                       OR (a term with zero-vote consensus — every
                                           run disagreed — regardless of risk_weight)
      → Log Extraction → Supabase (extractions, incl. needs_human_review, self_consistency_runs)
  ← JSON response ← Respond to Webhook

Every external call (LLM agents, both Supabase writes) retries 3x with a
delay before giving up. On terminal failure: the node's own error branch
responds with a specific status code/message, AND n8n's workflow-level Error
Workflow setting fires in parallel
  → Contract Analyzer - Error Handler → Supabase (error_log)
```

**Why extraction moved out of the agent-tool pattern:** contract-type detection
and playbook lookup still run as an LLM agent calling a tool (Orchestrator Agent
→ contract_playbook_agent), same as before. Key term extraction doesn't, anymore
— self-consistency voting needs the extraction prompt to run exactly N times on
the same input, and an LLM agent's own judgment about how many times to call a
tool isn't reliable enough to guarantee that. So the workflow itself (not the
LLM) fans out to exactly 3 direct Anthropic API calls, and a plain Code node
votes on the 3 results. Deterministic, inspectable in n8n's UI as 3 literal node
runs, and not dependent on the Orchestrator following an instruction correctly.

## Setup order

1. **Supabase** — free up a project slot (delete/pause an unused one; don't pay
   for Pro just for this). Run `supabase/schema.sql` in the SQL editor. It
   creates `contract_playbook` (seeded with starter rows), `extractions`, and
   `error_log`. If you already ran an earlier version of this file, just run
   the `alter table extractions add column if not exists ...` lines near
   the bottom to pick up `needs_human_review` / `review_reason` /
   `self_consistency_runs`.
2. **n8n** — import `n8n/error-handler.workflow.json` first, reconnect its
   Supabase credential (project URL is already set to
   `deezsambjmjmdqwodqhs.supabase.co`), publish it, and copy its workflow ID.
   Then import `n8n/contract-analyzer.workflow.json` **and**
   `n8n/update-term.workflow.json`, reconnect the Anthropic + Supabase (service
   role — see below) credentials on both, paste the error-handler's workflow ID
   into each one's Settings → Error Workflow, and publish both. Copy both
   production webhook URLs. **New in v4:** the `Extract Key Terms (Run N)` node
   is a plain HTTP Request node calling the Anthropic API directly (not a
   LangChain node) — it needs its own Anthropic credential selected
   (Authentication → Predefined Credential Type → Anthropic API) after import;
   it does not inherit the Anthropic Chat Model node's connection.
3. **Frontend** — put the two webhook URLs into `frontend/config.js`
   (`webhookUrl` and `updateWebhookUrl`), then deploy `frontend/` to Vercel as a
   static site (no build step). Once you have the Vercel domain, go back into
   both webhook nodes' `allowedOrigins` and replace the placeholder with it,
   then re-publish.
4. **Eval** — once the pipeline is live, run:
   ```bash
   WEBHOOK_URL=https://your-n8n-instance/webhook/xxxx node eval/score.mjs
   ```
   This drives the real deployed webhook against the three golden documents in
   `eval/golden-dataset/` and scores contract-type accuracy, party recall, and
   per-field key-term accuracy against `expected.json`. Report written to
   `eval/report.json`.

## What's in the golden set

All three documents in `eval/golden-dataset/` are synthetic, written for this
project — `acord-01.pdf`, `sov-01.pdf`, `lossrun-01.pdf` — a single fictional
submission package (one insured, one broker, one prior carrier) rather than
three unrelated documents, matching how a real underwriter actually receives
a submission. The original real lease document from an earlier direction is
preserved in `eval/archive/` rather than deleted, but is no longer part of the
active demo or eval set.

**One deliberate honest gap carried over from the earlier version:** the Loss
Run's `loss_ratio` field is expected to come back "Not specified" — the
document explicitly states the carrier doesn't disclose premium basis on loss
runs, so there's nothing to calculate a ratio from. Same "can't compute what
isn't stated" pattern as before, just relocated to a field that's actually
native to this domain instead of borrowed from IFRS16 lease accounting.

**Golden dataset is still a placeholder for a real HHH-framework eval** —
structured questions with a subject-matter-reviewed expected answer and a
Helpful/Honest/Harmless rubric, not just "field value matches." Pending a
reference example before rebuilding properly with the `ai-eval-hhh` skill.

## Citations (the trust feature)

Each extracted term can carry a `source_quote` — a verbatim sentence the model
pulled from the contract to support that value — and the Results screen makes
it clickable via a slide-over panel, matching the "target the moment of trust"
idea from [Trust Transcript.docx](Trust%20Transcript.docx): don't just assert a
value, show exactly where it came from, in the shortest form that still proves
it (one sentence, not the whole clause — "reduce cognitive load").

**This is not RAG.** There's no retrieval step, no vector database, no
similarity search across a corpus — the full contract text is already in the
prompt when the model extracts each term, so citing it is just one more field
in the same response, not a separate lookup. Worth being precise about this
distinction out loud in the interview.

**Confidence scores are numeric now, but not from the model rating itself.**
Earlier versions of this build deliberately avoided a numeric confidence score
— a model asked to self-rate its own confidence 0–100 produces a number that
looks precise but isn't statistically calibrated to anything, so the UI only
showed a coarse binary (Verified / Needs Review). That objection doesn't apply
to **self-consistency voting**: the extraction prompt runs 3 independent times
at temperature 0.7, and the confidence score is just the agreement fraction
across those 3 actual runs (e.g. "3/3" = 100%, "2/3" = 67%) — an observed
statistic about the model's own behavior, not a number it made up about itself.
Still matches the T.R.U.S.T. framework's "Uncertainty as a UX Feature" step —
if anything more honestly, since low agreement is now visible instead of
collapsed into the same "Needs Review" bucket as "no citation found at all."
The per-field `reasoning` (1–3 sentences citing what the source text actually
says) and the confidence fraction are both surfaced together in the citation
panel, in that order — Answer, then Reasoning, then Confidence, then the
verbatim quote — so a reviewer sees the model's stated justification right next
to the number, not just the number alone.

A term where **all 3 runs disagree** (no majority at all) is flagged for human
review regardless of its playbook `risk_weight` — see Gate 2 below. This is the
one case self-consistency voting can surface that the old citation-only gate
couldn't: the model can be internally consistent about a wrong answer just as
easily as it can be inconsistent about a right one, but "the model can't agree
with itself across 3 independent tries" is a distinct, honest signal on its own.

## Editing extracted values (CRUD, and the feedback-loop half of trust)

Every value in the Results table has an edit pencil. Editing and saving a
value:
- Sends the whole updated `key_terms` array to a second n8n workflow
  (`n8n/update-term.workflow.json`), which PATCHes that same row in the
  `extractions` table by id — a real write, not just a client-side change.
- Flips Confidence to **Verified · Edited** and Source to **Manually Edited**,
  clearing the (now stale) `source_quote`.

This is the "Tight Feedback Loops" step of T.R.U.S.T. — a human correction
actually persists instead of evaporating when the tab closes, which is what
would make it usable as a training/eval signal later (not built here, but the
loop existing at all is the point).

**Known gaps, stated plainly rather than hidden:** no audit history of what
the value used to be, no re-verification that a citation is real (see the
citations caveat above), and no auth check on who's allowed to edit — anyone
with the page can edit any value. Fine for a solo demo; not fine for
production, and worth saying so unprompted if asked.

## Human-in-the-loop design: where the human goes, and why

Directly answers the JD's own framing: *"The most important decisions in this
role are not purely technical — they determine where AI acts autonomously and
where human expertise remains essential."* Two gates, deliberately **not**
a third LLM classifier agent:

**Gate 1 — pre-flight sanity check** (`n8n/contract-analyzer.workflow.json`,
"Sanity Check Extraction" node), right after PDF text extraction, before any
agent runs at all. A plain code check: is the extracted text long enough and
alphanumeric enough to even be a real contract? Catches corrupted, encrypted,
or scanned-image PDFs at the earliest possible point — before spending an LLM
call on garbage, and before a bad document can propagate silently downstream.
This is the fix for "errors happening early but only getting caught late":
now they get caught at the first possible step instead.

**Gate 2 — the actual human-review trigger** (`Parse Result` node):
`needs_human_review = true` when either of two independent conditions is met.
The original condition: a term is **both** high-stakes (playbook `risk_weight`
4-5) **and** unverified (no `source_quote`). Not risk alone — that would flag
nearly every real submission document and kill the automation story. Not
missing-citation alone — that would flag low-stakes gaps nobody cares about.
Only the intersection: escalate on uncertainty, conditioned on stakes. The
second, added with self-consistency voting: a term where **all 3 extraction
runs disagreed** (no majority value at all) is flagged **regardless of
risk_weight** — internal inconsistency is its own reason for distrust, whether
or not the field happens to be high-stakes. Both are "escalate to a human when
genuinely uncertain, not merely because something is risky" — and Gate 2 still
sits exactly where it should: right before a report would go to the
broker/carrier, using data the system already computes rather than a fresh
judgment call.

The Results screen surfaces this as a whole-submission status badge using
BoundAI's own vocabulary from their site (**Auto-cleared** / **Flagged**) —
a document-level signal, deliberately separate from the per-field
Verified/Needs Review confidence column, since "is this submission okay to
move forward" and "is this specific field trustworthy" are different
questions answered by the same underlying Gate 2 data.

**Why not an upfront classifier/router agent choosing between cheap/mid/
expensive models per document:** an LLM deciding whether to trust an LLM is
circular, adds a new failure mode and cost line, and is harder to defend to
an audit-focused buyer (the PRD's Jennifer/GC persona) than a deterministic,
inspectable rule. The tiered-model idea is still a legitimate answer to give
verbally — Haiku for the actual extraction, something like Sonnet reserved
as a second-pass verifier *only* on whatever Gate 2 already flagged — but
it's a refinement of Gate 2, not a separate upfront step, and isn't built
here to avoid adding LLM complexity that doesn't earn its keep in a demo.

## Verifying research before using it in an interview

While preparing this, InsightFlow (a personal research tool) was run against
BoundAI to synthesize likely customer pain points. It generated specific
quotes attributed to "G2 Paraphrase" and "Capterra Paraphrase" sources (e.g.
*"When the OCR misreads a limit, it cascades through the entire quote"*).
Independent web search turned up real press coverage and case studies for
BoundAI/OIP Insurtech (Insurance Journal, their own case study pages — the
"80% reduction in compliance review time" and "sub-60-second submission
generation" stats are real and corroborated), but **no findable G2 or
Capterra listing at all** — meaning those specific quotes are very likely
fabricated by the research tool, not real customer feedback.

**Don't cite those quotes as real in the interview.** Two honest ways to use
this instead: cite InsightFlow's general trend signals instead (legitimate,
generic industry claims about explainable AI and human-in-the-loop demand),
or better — use the fabrication itself as the story: a research tool
confidently inventing specific, plausible, wrongly-sourced quotes when it
can't find real ones is the exact same failure mode this whole project is
built to catch, which is why this build verifies citations against the
source document rather than trusting model output at face value.

## A real production bug, and how it got isolated

`Parse Result` hung indefinitely (300s task-runner timeout, every single run,
survived a full VPS restart) while every other node in the same execution —
including another Code node right before it — succeeded normally. Bisection,
not guessing:
1. Ruled out "task runner is just broken" by testing a trivial `return
   [{json:{ok:true}}]` in the same node with the same pinned real input —
   completed instantly. Task runner was healthy; the problem was specific to
   this node's actual logic.
2. Re-added the real parsing/filtering logic but stripped the two
   `$('Webhook').item...` lookups — completed instantly with correct output.
   Isolated the hang to those two lines specifically.

**Root cause:** a cross-node `$('NodeName')` lookup made from *inside
Code-node JavaScript* hangs on this self-hosted instance (n8n 2.21.7) —
Code nodes run in a separate Task Runner sandbox process, and that lookup
requires an RPC-style call back to the main n8n process over a broker
connection that isn't completing. The same *kind* of lookup works fine
elsewhere in this same workflow as a parameter **expression**
(`{{ $('Webhook').item.json.body.intent }}` in the Orchestrator Agent's own
prompt) — expressions are evaluated by the main process directly, never
shipped out to the Task Runner. Same-looking syntax, two different
execution paths, only one of which is broken on this deployment.

**Fix:** removed the lookup rather than working around it — neither
`file_name` nor `intent` was actually consumed anywhere downstream (the
frontend already knows the filename from the upload itself), so the two
fields were a nice-to-have Supabase audit column, not load-bearing. If
they're wanted back, the correct fix is a Set/Edit Fields node (parameter
expressions, not Code-node JS) between the agent and Parse Result — not
reaching for `$()` inside a Code node's own JavaScript again.

## Interview talking points this build supports

**Bugs found in the original lab build, and what was done about them:**
- Hardcoded n8n memory session key (`"test_session"`) meant every request
  shared the same conversation memory — a real cross-user data leak risk under
  concurrent load. Fixed by keying memory on `$execution.id`.
- No input validation — a missing file or empty playbook match would fail deep
  in the agent graph with an opaque error. Added a validation step that returns
  a clean 400 with a specific reason.
- No error observability — failures vanished silently. Added an error workflow
  (adapted from an existing n8n error-handling pattern) that logs failures to
  Supabase instead of losing them.
- No results persistence — nothing was auditable after the fact. Added an
  `extractions` log table.
- Wide-open webhook (`allowedOrigins: "*"`) — narrowed to the actual frontend
  domain.
- `onError: continueErrorOutput` was set on two nodes with nothing wired to
  their error output — meaning failures weren't crashing, they were
  vanishing. n8n was silently dropping the data with no response, no log,
  nothing. Every error-prone node's error branch now goes somewhere real: a
  specific status code and message back to the caller.

**What's intentionally left as a roadmap item (not built):**
- Tiered model routing — everything here runs on Haiku 4.5 (cheap, fast,
  plenty accurate for scoped extraction). A real version would tier by risk:
  Haiku for classification and low-weight fields, something like Sonnet for
  risk-weight 4-5 terms (total insured value, loss history, coverage lines)
  or as a second-pass verifier on anything the playbook flags as high-risk.
  Deliberate cost/accuracy tradeoff for a demo, not an oversight.
- Risk-scoring agent — the schema has a `risk_weight` column and the
  orchestrator's prompt explicitly refuses to call a `contract_risk_agent`,
  but it's never implemented. Good "what would you build next" answer: score
  each extracted term against its playbook risk weight and surface a
  contract-level risk rollup.
- Retries are fixed-delay (3 tries, a flat wait between each), not
  exponential backoff — n8n's built-in retry doesn't do backoff natively;
  real exponential backoff would need a custom Code-based retry loop. Honest
  gap, not hidden.
- No duplicate-detection or cross-document reconciliation, which is literally
  BoundAI's actual product ("Duplicate Detection", "Exposure and Loss
  Validation") — worth naming explicitly as the gap between this toy demo and
  a production insurance-submission pipeline.
- Evals are field-level fuzzy-match accuracy against a 3-document golden set,
  not a proper LLM-as-judge or human-reviewed rubric — fine for a demo, not
  enough for production; a real system needs a larger, continuously-updated
  golden set and inter-rater agreement on what "correct" extraction means.
- Citations are unverified — the model is instructed not to fabricate a quote,
  but nothing programmatically checks that `source_quote` is an actual
  substring of the uploaded document. A production version would verify the
  quote against the source text server-side before ever showing it as a
  citation, since a plausible-looking but fabricated citation is worse for
  trust than no citation at all.
- No "edit reasoning" layer (capturing why a human overrode a value when they
  edit it) and no amortization schedule or PDF export — the fuller reference
  prototype has all three. The extraction agent's own `reasoning` field
  (why *it* concluded a value) is built; a human's own reasoning for
  overriding that is not, which is the more interesting version of "reasoning
  layer" for a production audit trail and a reasonable "what's next" answer.
