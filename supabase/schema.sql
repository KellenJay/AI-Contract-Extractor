-- BoundAI-style Contract Intelligence demo — Supabase schema
-- Run this in the Supabase SQL editor for a fresh project.

-- 1. Playbook: the rules the extraction agent is allowed to look for, per contract type.
-- Schema and seed match what's actually live in the project's Supabase instance —
-- keep this file in sync with the real table rather than the other way around.
create table if not exists contract_playbook (
  id uuid default gen_random_uuid() primary key,
  contract_type text not null,
  key_term_name text not null,
  key_term_label text not null,
  key_term_description text,
  risk_weight integer default 1,
  created_at timestamptz default now()
);

-- v2: replaced NDA/MSA/LEASE with insurance submission document types
-- (ACORD application, Statement of Values, Loss Run) — see README for why.
-- If your live table still has the old NDA/MSA/LEASE rows, run this first:
--   delete from contract_playbook;

insert into contract_playbook (contract_type, key_term_name, key_term_label, key_term_description, risk_weight) values
  ('ACORD', 'named_insured',        'Named Insured',        'The applicant business named as insured', 3),
  ('ACORD', 'mailing_address',      'Mailing Address',      'The applicant business address', 2),
  ('ACORD', 'business_description', 'Nature of Business',   'What the applicant business actually does', 3),
  ('ACORD', 'effective_date',       'Proposed Effective Date', 'When the requested policy would start', 4),
  ('ACORD', 'lines_of_business',    'Coverage Requested',   'Which insurance lines are being applied for', 5),
  ('ACORD', 'prior_carrier',        'Prior/Expiring Carrier', 'The applicant''s current or most recent insurer', 3),
  ('ACORD', 'loss_history_summary', 'Loss History Summary', 'Summary of past claims disclosed on the application', 5),
  ('ACORD', 'total_insured_value',  'Total Insured Value',  'Aggregate value being insured across all locations', 5),

  ('SOV', 'number_of_locations', 'Number of Locations', 'How many insured locations are on this schedule', 3),
  ('SOV', 'total_insured_value', 'Total Insured Value',  'Aggregate insured value across all locations', 5),
  ('SOV', 'construction_type',   'Construction Type',    'Building construction classification per location', 4),
  ('SOV', 'occupancy',           'Occupancy',             'How each location is actually used', 3),
  ('SOV', 'protection_class',    'Protection Class',      'Fire protection class rating per location', 4),
  ('SOV', 'year_built',          'Year Built',            'Construction year per location', 2),
  ('SOV', 'sprinklered',         'Sprinklered',           'Whether a sprinkler system is present', 4),
  ('SOV', 'square_footage',      'Square Footage',        'Total square footage per location', 2),

  ('LOSS_RUN', 'insured_name',          'Insured Name',           'The named insured this loss run covers', 2),
  ('LOSS_RUN', 'policy_period_covered', 'Policy Period Covered',  'The date range of policies this loss run reports on', 3),
  ('LOSS_RUN', 'number_of_claims',      'Total Number of Claims', 'Count of claims reported in this loss run', 4),
  ('LOSS_RUN', 'total_incurred',        'Total Incurred',         'Sum of paid and reserved amounts across all claims', 5),
  ('LOSS_RUN', 'open_claims_count',     'Open Claims Count',      'How many claims remain open/unresolved', 4),
  ('LOSS_RUN', 'largest_claim_amount',  'Largest Claim Amount',   'The single largest claim by incurred amount', 4),
  ('LOSS_RUN', 'loss_ratio',            'Loss Ratio',             'Losses as a percentage of premium, if disclosed', 5),
  ('LOSS_RUN', 'claims_by_cause',       'Claims by Cause',        'Breakdown of claims by cause or peril', 3);

-- No unique constraint on (contract_type, key_term_name), so re-running the inserts
-- above will duplicate rows — only run this file once against a fresh (or cleared) table.

-- 2. Extractions: every analyzed contract, so we have an audit trail and a place to log
-- observability data (latency, model used, raw agent output) without a separate tool.
create table if not exists extractions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  file_name text,
  intent text,
  contract_type text,
  parties jsonb,
  effective_date text,
  key_terms jsonb,
  raw_response jsonb,
  model text,
  latency_ms int,
  needs_human_review boolean default false,
  review_reason text,
  self_consistency_runs int
);

-- If you already ran this file once against your live project, you only need
-- to run these two lines to pick up the human-review gate:
alter table extractions add column if not exists needs_human_review boolean default false;
alter table extractions add column if not exists review_reason text;

-- v4: self-consistency voting replaced the binary Verified/Needs Review confidence
-- signal with a real one — N independent extraction runs, majority vote per field,
-- agreement fraction as confidence. Per-field confidence_fraction/reasoning/
-- no_consensus already live inside the key_terms jsonb array (no schema change
-- needed there); only the run count itself needs its own column:
alter table extractions add column if not exists self_consistency_runs int;

-- v5: cost observability — real input/output token counts summed across the 3
-- self-consistency "Extract Key Terms (Run N)" calls (the Anthropic Messages API
-- returns `usage` on every response, unlike the LangChain agent nodes elsewhere in
-- this workflow, which don't expose token usage to workflow data at all — only to
-- n8n's own execution-log UI). extraction_cost_usd is computed from those tokens
-- at Claude Haiku 4.5 list price ($1/MTok in, $5/MTok out) at insert time, not
-- looked up live, so it stays correct even if pricing changes later — it's a
-- snapshot of what that specific run actually cost. Deliberately does NOT include
-- the Orchestrator Agent or contract_playbook_agent calls (undercounts total
-- pipeline cost by roughly the size of one more full-document call) — see README.
alter table extractions add column if not exists extraction_input_tokens int;
alter table extractions add column if not exists extraction_output_tokens int;
alter table extractions add column if not exists extraction_cost_usd numeric;

create index if not exists extractions_created_at_idx on extractions (created_at desc);
create index if not exists extractions_contract_type_idx on extractions (contract_type);
create index if not exists extractions_needs_human_review_idx on extractions (needs_human_review) where needs_human_review;

-- 3. Error log: destination for the n8n error workflow (adapted from your
-- "Section 2 - Error Handler" pattern) instead of posting to the academy endpoint.
create table if not exists error_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  workflow_name text,
  workflow_id text,
  execution_url text,
  error_message text,
  failed_node text,
  payload jsonb
);

create index if not exists error_log_created_at_idx on error_log (created_at desc);

-- 4. Row Level Security: on, with no policies, on all three tables.
-- Free on every Supabase tier — this is not a cost decision.
-- n8n connects with the service role key, which bypasses RLS entirely, so this
-- doesn't affect the app. It just means that if the anon/public key ever gets
-- used anywhere (e.g. a future direct-from-frontend Supabase read), it gets zero
-- rows back by default instead of full read/write access to everything below.
alter table contract_playbook enable row level security;
alter table extractions enable row level security;
alter table error_log enable row level security;
