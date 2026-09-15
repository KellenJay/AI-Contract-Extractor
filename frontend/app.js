(function () {
  const WEBHOOK_URL = window.CONTRACT_ANALYZER_CONFIG?.webhookUrl || "";
  const UPDATE_WEBHOOK_URL = window.CONTRACT_ANALYZER_CONFIG?.updateWebhookUrl || "";

  // ---------- Screen navigation ----------
  const screens = {
    upload: document.getElementById("screen-upload"),
    results: document.getElementById("screen-results"),
    playbook: document.getElementById("screen-playbook"),
  };
  const navItems = document.querySelectorAll(".nav-item");

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => { el.hidden = key !== name; });
    navItems.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.screen === name));
  }

  navItems.forEach((btn) => btn.addEventListener("click", () => showScreen(btn.dataset.screen)));
  document.getElementById("results-empty-cta").addEventListener("click", () => showScreen("upload"));

  document.addEventListener("click", (e) => {
    const navLink = e.target.closest("[data-nav-screen]");
    if (navLink) {
      e.preventDefault();
      showScreen(navLink.dataset.navScreen);
    }
  });

  // ---------- Sidebar collapse ----------
  const appEl = document.querySelector(".app");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  try {
    if (localStorage.getItem("sidebarCollapsed") === "true") {
      appEl.classList.add("is-sidebar-collapsed");
    }
  } catch (e) { /* localStorage unavailable — default to expanded */ }

  sidebarToggle.addEventListener("click", () => {
    const collapsed = appEl.classList.toggle("is-sidebar-collapsed");
    try { localStorage.setItem("sidebarCollapsed", String(collapsed)); } catch (e) { /* ignore */ }
  });

  // ---------- Upload screen state machine ----------
  const uploadViews = {
    upload: document.getElementById("view-upload"),
    loading: document.getElementById("view-loading"),
    error: document.getElementById("view-error"),
  };

  function showUploadView(name) {
    Object.entries(uploadViews).forEach(([key, el]) => { el.hidden = key !== name; });
  }

  const form = document.getElementById("upload-form");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const filePreview = document.getElementById("file-preview");
  const filePreviewName = document.getElementById("file-preview-name");
  const filePreviewFrame = document.getElementById("file-preview-frame");
  const configHint = document.getElementById("config-hint");

  let selectedFile = null;
  let selectedFileUrl = null;

  if (!WEBHOOK_URL || WEBHOOK_URL.includes("YOUR-N8N-INSTANCE")) {
    configHint.textContent =
      "Heads up: no webhook URL configured yet. Set window.CONTRACT_ANALYZER_CONFIG.webhookUrl in config.js.";
  }

  function setSelectedFile(file) {
    selectedFile = file;
    if (file) {
      selectedFileUrl = URL.createObjectURL(file);
      filePreviewName.textContent = file.name;
      filePreviewFrame.src = selectedFileUrl;
      dropzone.hidden = true;
      filePreview.hidden = false;
    } else {
      selectedFileUrl = null;
      filePreviewFrame.src = "";
      dropzone.hidden = false;
      filePreview.hidden = true;
    }
  }

  fileInput.addEventListener("change", (e) => setSelectedFile(e.target.files?.[0] || null));

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      setSelectedFile(file);
    }
  });

  document.getElementById("file-preview-change").addEventListener("click", () => {
    fileInput.value = "";
    setSelectedFile(null);
  });

  document.getElementById("error-retry").addEventListener("click", resetUpload);

  function resetUpload() {
    setSelectedFile(null);
    fileInput.value = "";
    showUploadView("upload");
  }

  // ---------- Results screen ----------
  const resultsEmpty = document.getElementById("results-empty");
  const resultsContent = document.getElementById("results-content");
  document.getElementById("result-restart").addEventListener("click", () => {
    showScreen("upload");
    resetUpload();
  });

  // Export to PDF: the browser's native print-to-PDF, not a generated file — no
  // library, no server round-trip, and print CSS hides everything but the report.
  document.getElementById("result-export-pdf").addEventListener("click", () => {
    window.print();
  });

  function riskClass(weight) {
    const w = Number(weight);
    if (w >= 4) return "risk-high";
    if (w >= 3) return "risk-mid";
    return "risk-low";
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function buildSummary(data) {
    const type = data.contract_type || "document";
    const terms = Array.isArray(data.key_terms) ? data.key_terms : [];
    const highRisk = terms.filter((t) => Number(t.risk_weight) >= 4);
    const partyCount = Array.isArray(data.parties) ? data.parties.length : 0;

    const parts = [];
    parts.push(`This ${type} document was extracted with ${terms.length} tracked term${terms.length === 1 ? "" : "s"}`);
    parts.push(partyCount ? `across ${partyCount} part${partyCount === 1 ? "y" : "ies"}` : "");
    let sentence = parts.filter(Boolean).join(" ") + ".";

    if (highRisk.length > 0) {
      const labels = highRisk.map((t) => t.label).filter(Boolean).slice(0, 3).join(", ");
      sentence += ` ${highRisk.length} term${highRisk.length === 1 ? "" : "s"} scored high risk (${labels}) and should be reviewed before sign-off.`;
    } else {
      sentence += " No terms scored high risk against the current playbook.";
    }
    return sentence;
  }

  // ---------- Results screen: state ----------
  let currentTerms = [];
  let currentExtractionId = null;
  let currentContractUrl = null;
  let editingIndex = null;
  const termsBody = document.getElementById("result-terms-body");

  function renderResults(data, fileName) {
    resultsEmpty.hidden = true;
    resultsContent.hidden = false;

    currentExtractionId = data.id ?? null;
    currentTerms = (Array.isArray(data.key_terms) ? data.key_terms : []).map((t) => ({ ...t, edited: false }));
    editingIndex = null;

    document.getElementById("result-contract-type").textContent = data.contract_type || "UNKNOWN";
    document.getElementById("result-filename").textContent = fileName || "Analysis Result";
    document.getElementById("result-date").textContent = data.effective_date || "Not specified";
    document.getElementById("result-summary").textContent = buildSummary(data);

    const allTerms = Array.isArray(data.key_terms) ? data.key_terms : [];
    const verifiedCount = allTerms.filter(
      (t) => typeof t.source_quote === "string" && t.source_quote.trim().length > 0
    ).length;
    const verificationRateEl = document.getElementById("verification-rate");
    const runsNote = data.self_consistency_runs
      ? ` · ${data.self_consistency_runs}x self-consistency vote per field`
      : "";
    verificationRateEl.textContent = allTerms.length
      ? `${verifiedCount}/${allTerms.length} fields verified (${Math.round((verifiedCount / allTerms.length) * 100)}%)${runsNote}`
      : "—";

    const reviewBanner = document.getElementById("review-banner");
    const docStatusEl = document.getElementById("doc-status");
    if (data.needs_human_review) {
      reviewBanner.hidden = false;
      document.getElementById("review-banner-reason").textContent =
        data.review_reason || "One or more high-risk terms could not be verified against the contract text.";
      docStatusEl.textContent = "Flagged";
      docStatusEl.className = "doc-status doc-status--flagged";
    } else {
      reviewBanner.hidden = true;
      docStatusEl.textContent = "Auto-cleared";
      docStatusEl.className = "doc-status doc-status--cleared";
    }

    const partiesEl = document.getElementById("result-parties");
    const parties = Array.isArray(data.parties) ? data.parties : [];
    partiesEl.innerHTML = parties.length
      ? parties.map((p) => `<li>${escapeHtml(typeof p === "string" ? p : JSON.stringify(p))}</li>`).join("")
      : "<li>Not specified</li>";

    if (!UPDATE_WEBHOOK_URL || UPDATE_WEBHOOK_URL.includes("YOUR-N8N-INSTANCE") || !currentExtractionId) {
      document.getElementById("config-hint-results").textContent = !currentExtractionId
        ? "Edits can't be saved: this response has no extraction id (check the Finalize Response node in n8n)."
        : "Edits can't be saved yet: set window.CONTRACT_ANALYZER_CONFIG.updateWebhookUrl in config.js.";
      document.getElementById("config-hint-results").hidden = false;
    } else {
      document.getElementById("config-hint-results").hidden = true;
    }

    renderTermsTable();
    showScreen("results");
  }

  function renderTermsTable() {
    termsBody.innerHTML = currentTerms.length
      ? currentTerms.map((term, i) => renderTermRow(term, i)).join("")
      : `<tr><td colspan="4">No key terms returned.</td></tr>`;
  }

  function renderTermRow(term, i) {
    const label = term.label ?? term.key_term_label ?? "—";
    const risk = term.risk_weight;
    const hasQuote = typeof term.source_quote === "string" && term.source_quote.trim().length > 0;
    const hasReasoning = typeof term.reasoning === "string" && term.reasoning.trim().length > 0;
    const noConsensus = term.no_consensus === true;
    const riskTag = risk != null
      ? `<span class="risk-tag ${riskClass(risk)}" title="How much this field matters if wrong, independent of whether it was found — see the risk scale on the Playbook tab">Risk ${escapeHtml(String(risk))}/5</span>`
      : "";

    if (editingIndex === i) {
      return `<tr class="is-editing">
        <td>${escapeHtml(label)}</td>
        <td colspan="2">
          <input type="text" class="edit-input" id="edit-input-${i}" value="${escapeHtml(String(term.value ?? ""))}" />
          <span class="edit-error" id="edit-error-${i}"></span>
        </td>
        <td class="edit-actions">
          <button class="btn-save" data-save-index="${i}">Save</button>
          <button class="btn-cancel" data-cancel-index="${i}">Cancel</button>
        </td>
      </tr>`;
    }

    const value = term.value ?? "Not specified";
    const fraction = term.confidence_fraction;
    const ratio = typeof term.confidence_ratio === "number" ? term.confidence_ratio : null;

    let confidenceBadge;
    if (term.edited) {
      confidenceBadge = `<span class="confidence-badge confidence-verified">Verified</span><span class="edited-tag">Edited</span>`;
    } else if (noConsensus) {
      confidenceBadge = `<span class="confidence-badge confidence-review" title="The self-consistency runs never agreed on a value — flagged regardless of risk weight">Needs Review</span>`;
    } else if (hasQuote && ratio === 1) {
      const title = fraction ? `${fraction} self-consistency runs agreed on this value` : "Verified";
      confidenceBadge = `<span class="confidence-badge confidence-verified" title="${escapeHtml(title)}">Verified</span>`;
    } else if (hasQuote) {
      const title = fraction ? `Only ${fraction} self-consistency runs agreed — click the source to see details` : "Needs Review";
      confidenceBadge = `<span class="confidence-badge confidence-review" title="${escapeHtml(title)}">Needs Review</span>`;
    } else {
      confidenceBadge = `<span class="confidence-badge confidence-review">Needs Review</span>`;
    }

    const clauseLabel = term.clause_ref && String(term.clause_ref).trim() ? String(term.clause_ref).trim() : null;
    const sourceCell = hasQuote
      ? `<button class="source-link" data-term-index="${i}" title="${escapeHtml(clauseLabel ?? "View source")}">${escapeHtml(clauseLabel ?? "View source")}</button>`
      : hasReasoning
        ? `<button class="source-link" data-term-index="${i}">View reasoning</button>`
        : term.edited
          ? `<span class="source-edited">Manually Edited</span>`
          : `<span class="source-none">—</span>`;

    return `<tr>
      <td>
        <span class="term-cell">
          <span>${escapeHtml(label)}</span>
          ${riskTag}
        </span>
      </td>
      <td>
        <span class="value-cell">
          <span>${escapeHtml(String(value))}</span>
          <button class="edit-pencil" data-edit-index="${i}" aria-label="Edit ${escapeHtml(label)}" title="Edit value">✎</button>
        </span>
      </td>
      <td>${confidenceBadge}</td>
      <td>${sourceCell}</td>
    </tr>`;
  }

  termsBody.addEventListener("click", async (e) => {
    const sourceBtn = e.target.closest(".source-link");
    if (sourceBtn) {
      const term = currentTerms[Number(sourceBtn.dataset.termIndex)];
      if (term) openDualPane(term);
      return;
    }

    const editBtn = e.target.closest(".edit-pencil");
    if (editBtn) {
      editingIndex = Number(editBtn.dataset.editIndex);
      renderTermsTable();
      document.getElementById(`edit-input-${editingIndex}`)?.focus();
      return;
    }

    const cancelBtn = e.target.closest(".btn-cancel");
    if (cancelBtn) {
      editingIndex = null;
      renderTermsTable();
      return;
    }

    const saveBtn = e.target.closest(".btn-save");
    if (saveBtn) {
      const i = Number(saveBtn.dataset.saveIndex);
      const input = document.getElementById(`edit-input-${i}`);
      const newValue = input.value.trim();
      const errorEl = document.getElementById(`edit-error-${i}`);

      if (!newValue) {
        errorEl.textContent = "Value can't be empty.";
        return;
      }
      if (!currentExtractionId || !UPDATE_WEBHOOK_URL || UPDATE_WEBHOOK_URL.includes("YOUR-N8N-INSTANCE")) {
        errorEl.textContent = "Can't save — update webhook isn't configured yet.";
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";

      const updatedTerms = currentTerms.map((t, idx) =>
        idx === i
          ? { ...t, value: newValue, edited: true, original_value: t.edited ? t.original_value : t.value }
          : t
      );

      try {
        const res = await fetch(UPDATE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extraction_id: currentExtractionId, key_terms: updatedTerms }),
        });
        const result = await res.json();
        if (!res.ok || result.valid === false || result.success === false) {
          throw new Error(result.error || `Save failed (${res.status})`);
        }
        currentTerms = updatedTerms;
        editingIndex = null;
        renderTermsTable();
      } catch (err) {
        errorEl.textContent = err.message || "Save failed — try again.";
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    }
  });

  // ---------- Dual-pane: document (PDF.js) + citation detail, shown together ----------
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  const dualpane = document.getElementById("dualpane");
  const dualpaneBackdrop = document.getElementById("dualpane-backdrop");
  const citationPlaceholder = document.getElementById("dualpane-citation-placeholder");
  const citationContent = document.getElementById("dualpane-citation-content");
  const docLoadingEl = document.getElementById("dualpane-doc-loading");
  const pageWrapEl = document.getElementById("dualpane-page-wrap");
  const canvasEl = document.getElementById("dualpane-canvas");
  const textLayerEl = document.getElementById("dualpane-textlayer");
  const pageIndicatorEl = document.getElementById("dualpane-page-indicator");
  const prevPageBtn = document.getElementById("dualpane-prev-page");
  const nextPageBtn = document.getElementById("dualpane-next-page");
  const docViewportEl = document.getElementById("dualpane-doc-viewport");

  let pdfDoc = null;
  let pdfDocUrl = null;
  let currentPageNum = 1;
  let currentPageCount = 1;
  let renderTaskToken = 0;
  let activeRenderTask = null;

  function normalizeForMatch(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function populateCitationContent(term) {
    const fileName = document.getElementById("result-filename").textContent || "the uploaded document";
    const hasQuote = typeof term.source_quote === "string" && term.source_quote.trim().length > 0;

    document.getElementById("citation-panel-term").textContent = term.label ?? "—";
    document.getElementById("citation-panel-answer").textContent = term.value ?? "Not specified";
    document.getElementById("citation-panel-reasoning").textContent =
      typeof term.reasoning === "string" && term.reasoning.trim()
        ? term.reasoning
        : "No reasoning returned by the agent for this term.";

    const editedBadge = document.getElementById("citation-panel-edited-badge");
    const answerOriginalEl = document.getElementById("citation-panel-answer-original");
    const wasChanged = term.edited && term.original_value != null && String(term.original_value) !== String(term.value);
    editedBadge.hidden = !term.edited;
    if (wasChanged) {
      answerOriginalEl.textContent = `Originally extracted as: ${term.original_value}`;
      answerOriginalEl.hidden = false;
    } else {
      answerOriginalEl.hidden = true;
    }

    const clauseBadge = document.getElementById("citation-panel-clause");
    const clauseRef = term.clause_ref && String(term.clause_ref).trim() ? term.clause_ref.trim() : null;
    if (clauseRef) {
      clauseBadge.textContent = clauseRef;
      clauseBadge.hidden = false;
    } else {
      clauseBadge.hidden = true;
    }

    const confidenceSection = document.getElementById("citation-panel-confidence-section");
    const confidenceEl = document.getElementById("citation-panel-confidence");
    if (term.confidence_fraction) {
      const ratio = typeof term.confidence_ratio === "number" ? term.confidence_ratio : null;
      confidenceEl.textContent = term.no_consensus
        ? `${term.confidence_fraction} runs agreed — no majority found, flagged for review regardless of risk weight`
        : ratio === 1
          ? `${term.confidence_fraction} independent extraction runs agreed on this value`
          : `Only ${term.confidence_fraction} independent extraction runs agreed on this value — flagged for review`;
      confidenceSection.hidden = false;
    } else {
      confidenceSection.hidden = true;
    }

    const sourceEl = document.getElementById("citation-panel-source");
    const quoteEl = document.getElementById("citation-panel-quote");
    if (hasQuote) {
      sourceEl.textContent = Number.isInteger(term.page_number)
        ? `From ${fileName}, page ${term.page_number}`
        : `From ${fileName}`;
      sourceEl.hidden = false;
      quoteEl.textContent = term.source_quote;
      quoteEl.hidden = false;
    } else {
      sourceEl.hidden = true;
      quoteEl.textContent = "No verbatim quote — the agent did not find this term stated in the document.";
      quoteEl.hidden = false;
    }
  }

  async function ensurePdfLoaded(url) {
    if (pdfDoc && pdfDocUrl === url) return pdfDoc;
    docLoadingEl.textContent = "Loading document…";
    docLoadingEl.hidden = false;
    pageWrapEl.hidden = true;
    const doc = await window.pdfjsLib.getDocument(url).promise;
    pdfDoc = doc;
    pdfDocUrl = url;
    currentPageCount = doc.numPages;
    return doc;
  }

  function highlightQuoteInTextLayer(items, textDivs, quote) {
    let normalized = "";
    const map = [];
    items.forEach((item, itemIndex) => {
      const collapsed = String(item.str || "").replace(/\s+/g, " ");
      for (const ch of collapsed) {
        normalized += ch.toLowerCase();
        map.push(itemIndex);
      }
      if (collapsed.length > 0) {
        normalized += " ";
        map.push(-1);
      }
    });

    // Some fields (e.g. a two-location schedule) get a source_quote that stitches
    // together facts from separate parts of the document with "; " — that combined
    // string never appears as one continuous run of text, so each ";"-delimited
    // segment is searched for and highlighted independently instead.
    const segments = String(quote ?? "").split(";").map((s) => normalizeForMatch(s)).filter(Boolean);
    if (segments.length === 0) return;

    let firstHitEl = null;
    for (const segment of segments) {
      const match = findSegment(normalized, segment);
      if (!match) continue;

      const end = match.start + match.text.length - 1;
      for (let k = match.start; k <= end; k++) {
        if (map[k] >= 0) {
          const el = textDivs[map[k]];
          if (el) {
            el.classList.add("pdf-highlight");
            if (!firstHitEl) firstHitEl = el;
          }
        }
      }
    }

    if (firstHitEl) {
      firstHitEl.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  // Returns {start, text} for the best match found, or null. Tries, in order:
  // 1. the segment verbatim: 2. with a synthetic "location N " labeling prefix
  // stripped — the model adds this to disambiguate a two-location field, but the
  // prefix often isn't adjacent to the fact in the source document's own layout;
  // 3. progressively shorter leading words, as a last resort for minor wording
  // drift, requiring a reasonably specific remainder so it can't collapse onto a
  // generic fragment like "location 1".
  function findSegment(normalized, segment) {
    let idx = normalized.indexOf(segment);
    if (idx !== -1) return { start: idx, text: segment };

    const withoutPrefix = segment.replace(/^location\s+\d+\s*/, "");
    if (withoutPrefix !== segment && withoutPrefix.length > 8) {
      idx = normalized.indexOf(withoutPrefix);
      if (idx !== -1) return { start: idx, text: withoutPrefix };
    }

    let candidate = withoutPrefix.length > 8 ? withoutPrefix : segment;
    while (candidate.length > 15) {
      idx = normalized.indexOf(candidate);
      if (idx !== -1) return { start: idx, text: candidate };
      const lastSpace = candidate.lastIndexOf(" ");
      if (lastSpace === -1) break;
      candidate = candidate.slice(0, lastSpace);
    }
    return null;
  }

  async function renderPage(pageNum, highlightQuote) {
    const token = ++renderTaskToken;
    if (!pdfDoc) return;
    pageNum = Math.min(Math.max(1, pageNum), currentPageCount);

    if (activeRenderTask) {
      try { activeRenderTask.cancel(); } catch (e) { /* already finished */ }
      activeRenderTask = null;
    }

    const page = await pdfDoc.getPage(pageNum);
    if (token !== renderTaskToken) return;

    const containerWidth = Math.max(280, docViewportEl.clientWidth - 32);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });

    canvasEl.width = viewport.width;
    canvasEl.height = viewport.height;
    canvasEl.style.width = `${viewport.width}px`;
    canvasEl.style.height = `${viewport.height}px`;
    pageWrapEl.style.width = `${viewport.width}px`;
    pageWrapEl.style.height = `${viewport.height}px`;

    const canvasContext = canvasEl.getContext("2d");
    const renderTask = page.render({ canvasContext, viewport });
    activeRenderTask = renderTask;
    try {
      await renderTask.promise;
    } catch (err) {
      if (err?.name === "RenderingCancelledException") return;
      throw err;
    } finally {
      if (activeRenderTask === renderTask) activeRenderTask = null;
    }
    if (token !== renderTaskToken) return;

    textLayerEl.innerHTML = "";
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;
    textLayerEl.style.setProperty("--scale-factor", String(viewport.scale));

    const textContent = await page.getTextContent();
    if (token !== renderTaskToken) return;

    const textDivs = [];
    try {
      await window.pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerEl,
        viewport,
        textDivs,
      }).promise;
    } catch (err) {
      console.warn("Text layer render failed — highlighting unavailable for this page.", err);
    }
    if (token !== renderTaskToken) return;

    currentPageNum = pageNum;
    pageIndicatorEl.textContent = `Page ${pageNum} of ${currentPageCount}`;
    prevPageBtn.disabled = pageNum <= 1;
    nextPageBtn.disabled = pageNum >= currentPageCount;

    docLoadingEl.hidden = true;
    pageWrapEl.hidden = false;

    if (highlightQuote && textDivs.length === textContent.items.length) {
      highlightQuoteInTextLayer(textContent.items, textDivs, highlightQuote);
    }
  }

  function openDualPane(term) {
    if (term) {
      populateCitationContent(term);
      citationPlaceholder.hidden = true;
      citationContent.hidden = false;
    } else {
      citationPlaceholder.hidden = false;
      citationContent.hidden = true;
      document.getElementById("citation-panel-term").textContent = "Contract document";
      document.getElementById("citation-panel-clause").hidden = true;
      document.getElementById("citation-panel-edited-badge").hidden = true;
    }

    document.getElementById("dualpane-doc-title").textContent =
      document.getElementById("result-filename").textContent || "Contract";

    dualpane.hidden = false;
    dualpaneBackdrop.hidden = false;

    if (!currentContractUrl) return;
    ensurePdfLoaded(currentContractUrl)
      .then(() => {
        const targetPage = term && Number.isInteger(term.page_number) && term.page_number > 0
          ? term.page_number
          : 1;
        const quote = term && typeof term.source_quote === "string" ? term.source_quote : null;
        return renderPage(targetPage, quote);
      })
      .catch((err) => {
        docLoadingEl.textContent = "Couldn't render this document for preview.";
        docLoadingEl.hidden = false;
        pageWrapEl.hidden = true;
        console.error(err);
      });
  }

  function closeDualPane() {
    dualpane.hidden = true;
    dualpaneBackdrop.hidden = true;
  }

  document.getElementById("dualpane-close").addEventListener("click", closeDualPane);
  dualpaneBackdrop.addEventListener("click", closeDualPane);
  prevPageBtn.addEventListener("click", () => renderPage(currentPageNum - 1, null));
  nextPageBtn.addEventListener("click", () => renderPage(currentPageNum + 1, null));

  document.getElementById("result-view-contract").addEventListener("click", () => {
    if (!currentContractUrl) return;
    openDualPane(null);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    showUploadView("loading");

    const body = new FormData();
    body.append("file", selectedFile);
    body.append("intent", "extract key terms");
    body.append("file_name", selectedFile.name);
    const analyzedFileUrl = selectedFileUrl;

    try {
      const res = await fetch(WEBHOOK_URL, { method: "POST", body });
      const data = await res.json();
      if (!res.ok || data.valid === false) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      showUploadView("upload");
      currentContractUrl = analyzedFileUrl;
      renderResults(data, selectedFile.name);
    } catch (err) {
      document.getElementById("error-message").textContent =
        err.message || "Something went wrong talking to the extraction service.";
      showUploadView("error");
    }
  });

  // ---------- Playbook screen ----------
  const playbookBody = document.getElementById("playbook-body");
  const playbookFilters = document.getElementById("playbook-filters");
  const playbookData = window.PLAYBOOK_DATA || [];
  let activeType = "ALL";

  function renderPlaybook() {
    const rows = activeType === "ALL" ? playbookData : playbookData.filter((r) => r.contract_type === activeType);
    playbookBody.innerHTML = rows.map((r) => `
      <tr>
        <td><span class="type-pill">${escapeHtml(r.contract_type)}</span></td>
        <td>${escapeHtml(r.key_term_label)}</td>
        <td>${escapeHtml(r.key_term_description)}</td>
        <td><span class="risk-badge ${riskClass(r.risk_weight)}">${r.risk_weight}/5</span></td>
      </tr>
    `).join("");
  }

  playbookFilters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    activeType = btn.dataset.type;
    [...playbookFilters.children].forEach((c) => c.classList.toggle("is-active", c === btn));
    renderPlaybook();
  });

  renderPlaybook();
})();
