// Fill these in once the n8n workflows are published (Execution > Publish > copy the
// production webhook URL). Kept as a separate file so it's obvious what to edit
// per environment (local test vs. the deployed Vercel build) without touching app.js.
window.CONTRACT_ANALYZER_CONFIG = {
  webhookUrl: "https://n8n.srv1696847.hstgr.cloud/webhook/7d90ba9a-649b-468e-95b5-0984450b83d8",
  updateWebhookUrl: "https://n8n.srv1696847.hstgr.cloud/webhook/update-term",
  historyWebhookUrl: "https://n8n.srv1696847.hstgr.cloud/webhook/extraction-history",
};
