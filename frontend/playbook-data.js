// Static mirror of supabase/schema.sql's contract_playbook seed, for the mockup.
// In production this screen would fetch from Supabase directly instead.
window.PLAYBOOK_DATA = [
  { contract_type: "ACORD", key_term_label: "Named Insured", key_term_description: "The applicant business named as insured", risk_weight: 3 },
  { contract_type: "ACORD", key_term_label: "Mailing Address", key_term_description: "The applicant business address", risk_weight: 2 },
  { contract_type: "ACORD", key_term_label: "Nature of Business", key_term_description: "What the applicant business actually does", risk_weight: 3 },
  { contract_type: "ACORD", key_term_label: "Proposed Effective Date", key_term_description: "When the requested policy would start", risk_weight: 4 },
  { contract_type: "ACORD", key_term_label: "Coverage Requested", key_term_description: "Which insurance lines are being applied for", risk_weight: 5 },
  { contract_type: "ACORD", key_term_label: "Prior/Expiring Carrier", key_term_description: "The applicant's current or most recent insurer", risk_weight: 3 },
  { contract_type: "ACORD", key_term_label: "Loss History Summary", key_term_description: "Summary of past claims disclosed on the application", risk_weight: 5 },
  { contract_type: "ACORD", key_term_label: "Total Insured Value", key_term_description: "Aggregate value being insured across all locations", risk_weight: 5 },

  { contract_type: "SOV", key_term_label: "Number of Locations", key_term_description: "How many insured locations are on this schedule", risk_weight: 3 },
  { contract_type: "SOV", key_term_label: "Total Insured Value", key_term_description: "Aggregate insured value across all locations", risk_weight: 5 },
  { contract_type: "SOV", key_term_label: "Construction Type", key_term_description: "Building construction classification per location", risk_weight: 4 },
  { contract_type: "SOV", key_term_label: "Occupancy", key_term_description: "How each location is actually used", risk_weight: 3 },
  { contract_type: "SOV", key_term_label: "Protection Class", key_term_description: "Fire protection class rating per location", risk_weight: 4 },
  { contract_type: "SOV", key_term_label: "Year Built", key_term_description: "Construction year per location", risk_weight: 2 },
  { contract_type: "SOV", key_term_label: "Sprinklered", key_term_description: "Whether a sprinkler system is present", risk_weight: 4 },
  { contract_type: "SOV", key_term_label: "Square Footage", key_term_description: "Total square footage per location", risk_weight: 2 },

  { contract_type: "LOSS_RUN", key_term_label: "Insured Name", key_term_description: "The named insured this loss run covers", risk_weight: 2 },
  { contract_type: "LOSS_RUN", key_term_label: "Policy Period Covered", key_term_description: "The date range of policies this loss run reports on", risk_weight: 3 },
  { contract_type: "LOSS_RUN", key_term_label: "Total Number of Claims", key_term_description: "Count of claims reported in this loss run", risk_weight: 4 },
  { contract_type: "LOSS_RUN", key_term_label: "Total Incurred", key_term_description: "Sum of paid and reserved amounts across all claims", risk_weight: 5 },
  { contract_type: "LOSS_RUN", key_term_label: "Open Claims Count", key_term_description: "How many claims remain open/unresolved", risk_weight: 4 },
  { contract_type: "LOSS_RUN", key_term_label: "Largest Claim Amount", key_term_description: "The single largest claim by incurred amount", risk_weight: 4 },
  { contract_type: "LOSS_RUN", key_term_label: "Loss Ratio", key_term_description: "Losses as a percentage of premium, if disclosed", risk_weight: 5 },
  { contract_type: "LOSS_RUN", key_term_label: "Claims by Cause", key_term_description: "Breakdown of claims by cause or peril", risk_weight: 3 },
];
