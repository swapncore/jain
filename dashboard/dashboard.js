/* Jaini Business Dashboard — dashboard.js */
(function () {
  "use strict";

  const API_BASE = "https://web-production-31034.up.railway.app";
  let _metricsData = null; // cached metrics for cross-tab use

  // ── Auth helpers ───────────────────────────────────────────────────────
  function getAdminKey() {
    return sessionStorage.getItem("JAINI_ADMIN_KEY") || "";
  }

  async function fetchWithAuth(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const key = getAdminKey();
    if (key) headers["X-Admin-Key"] = key;
    return fetch(url, { ...options, headers });
  }

  async function checkSession() {
    const key = getAdminKey();
    if (key) {
      try {
        const resp = await fetch(`${API_BASE}/v1/admin/products?limit=1`, {
          headers: { "X-Admin-Key": key },
        });
        if (resp.ok) { showDashboard({ display_name: "Admin", role: "admin" }); return; }
      } catch (e) {}
      sessionStorage.removeItem("JAINI_ADMIN_KEY");
    }
    showAuthGate();
  }

  function showAuthGate() {
    document.getElementById("authGate").style.display = "flex";
    document.getElementById("dashboardContent").style.display = "none";
  }

  document.getElementById("adminKeySubmit")?.addEventListener("click", handleAdminKeyLogin);
  document.getElementById("adminKeyInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAdminKeyLogin();
  });

  async function handleAdminKeyLogin() {
    const input = document.getElementById("adminKeyInput");
    const key = input?.value?.trim();
    if (!key) return;
    const btn = document.getElementById("adminKeySubmit");
    const errorEl = document.getElementById("authError");
    btn.disabled = true; btn.textContent = "Signing in..."; errorEl.style.display = "none";
    try {
      const resp = await fetch(`${API_BASE}/v1/admin/products?limit=1`, { headers: { "X-Admin-Key": key } });
      if (resp.ok) {
        sessionStorage.setItem("JAINI_ADMIN_KEY", key);
        showDashboard({ display_name: "Admin", role: "admin" });
      } else {
        errorEl.textContent = resp.status === 429 ? "Too many failed attempts." : "Invalid admin key.";
        errorEl.style.display = "block";
      }
    } catch (e) {
      errorEl.textContent = "Connection error."; errorEl.style.display = "block";
    } finally { btn.disabled = false; btn.textContent = "Sign In"; }
  }

  function showDashboard(user) {
    document.getElementById("authGate").style.display = "none";
    document.getElementById("dashboardContent").style.display = "block";
    const info = document.getElementById("userInfo");
    info.textContent = user.display_name || "Admin";
    if (user.avatar_url) info.innerHTML = `<img src="${esc(user.avatar_url)}" alt=""> ${esc(user.display_name || "Admin")}`;
    loadMetrics();
  }

  // ── Tab navigation ─────────────────────────────────────────────────────
  function navigateToTab(tab, options) {
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    const link = document.querySelector(`.nav-link[data-tab="${tab}"]`);
    if (link) link.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.classList.add("active");
    const title = link ? link.textContent.trim() : tab;
    document.getElementById("pageTitle").textContent = title;
    if (tab === "scans") renderScanInsights();
    if (tab === "photos") {
      if (options && options.filter !== undefined) {
        const sel = document.getElementById("photoStatusFilter");
        if (sel) sel.value = options.filter;
      }
      loadPhotos();
    }
    if (tab === "brands") loadBrands();
    if (tab === "placements") loadPlacements();
    if (tab === "email") loadEmailTab();
    if (tab === "users") loadUsers();
    if (tab === "reports") loadReports();
    if (tab === "recent-scans") loadRecentScans();
  }

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToTab(link.dataset.tab);
    });
  });

  // ── Clickable metric cards ─────────────────────────────────────────────
  document.getElementById("overviewGrid")?.addEventListener("click", (e) => {
    const card = e.target.closest(".metric-card[data-navigate]");
    if (!card) return;
    const tab = card.dataset.navigate;
    const filter = card.dataset.filter;
    navigateToTab(tab, { filter: filter });
  });

  // ── Load metrics ───────────────────────────────────────────────────────
  async function loadMetrics() {
    try {
      const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/metrics?days=30`);
      if (resp.ok) {
        _metricsData = await resp.json();
        renderMetrics(_metricsData);
        return;
      }
      const resp2 = await fetchWithAuth(`${API_BASE}/v1/admin/metrics?days=30`);
      if (resp2.ok) { renderOldMetrics(await resp2.json()); }
    } catch (e) { console.error("Failed to load metrics:", e); }
  }

  function renderMetrics(d) {
    const u = d.users || {};
    setText("m-totalUsers", fmt(u.total));
    setText("m-newUsers7d", fmt(u.new_this_week));
    setText("m-activeUsers7d", fmt(u.active_this_week));
    setText("m-activeUsers30d", fmt(u.active_this_month));
    setText("m-scans30d", fmt((d.scans || {}).total_30d));
    setText("m-favorites", fmt((d.favorites || {}).total));
    setText("m-submissions", fmt((d.submissions || {}).total));
    setText("m-pendingPhotos", fmt((d.submissions || {}).pending_photos));

    // Monetization
    const mon = d.monetization || {};
    setText("m-impressions", fmt(mon.impressions_30d));
    setText("m-clicks", fmt(mon.clicks_30d));
    setText("m-ctr", (mon.ctr_pct || 0) + "%");
    renderTable("topPlacementsTable", mon.top_placements || [],
      ["product_name", "brand", "disclosure", "impressions", "clicks"]);

    // Email
    setText("m-emailOptedIn", fmt((d.email || {}).opted_in_users));
    const digest = (d.email || {}).last_digest;
    document.getElementById("lastDigestInfo").textContent = digest
      ? `Status: ${digest.status} | Sent to: ${digest.users_sent} users | ${digest.run_at}`
      : "No digest runs yet.";
  }

  function renderOldMetrics(d) {
    const o = d.overview || {};
    setText("m-scans30d", fmt(o.scans_30d));
    setText("m-activeUsers7d", fmt(o.unique_devices_7d));
    setText("m-activeUsers30d", fmt(o.unique_devices_30d));
  }

  // ── Scan Insights ─────────────────────────────────────────────────────
  function renderScanInsights() {
    const si = (_metricsData || {}).scan_insights || {};
    const outcomes = si.outcomes || [];
    const verdicts = si.verdicts || [];
    const geo = si.geo || [];
    const topScanned = si.top_scanned || [];

    // Outcome cards
    const outcomeColors = { hit: "#16a34a", not_found: "#ea580c", error: "#dc2626", rate_limited: "#6b7280", invalid_barcode: "#94a3b8" };
    const outcomeIcons = { hit: "&#9989;", not_found: "&#10060;", error: "&#9888;", rate_limited: "&#128683;", invalid_barcode: "&#128285;" };
    const cardsEl = document.getElementById("scanOutcomeCards");
    if (outcomes.length) {
      cardsEl.innerHTML = outcomes.map(o => `
        <div class="metric-card scan-outcome-card" data-outcome="${esc(o.outcome)}" style="cursor:pointer;" title="Click to see top scanned products">
          <div class="metric-icon" style="background:${outcomeColors[o.outcome] || '#94a3b8'}22;color:${outcomeColors[o.outcome] || '#94a3b8'};">${outcomeIcons[o.outcome] || '&#9632;'}</div>
          <div><div class="metric-label">${esc(o.outcome.replace(/_/g, ' '))}</div><div class="metric-value">${fmt(o.count)}</div></div>
        </div>
      `).join("");
      // Scroll to top scanned table when an outcome card is clicked
      cardsEl.querySelectorAll(".scan-outcome-card").forEach(card => {
        card.addEventListener("click", () => {
          const table = document.getElementById("topScannedTable");
          if (table) table.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    } else {
      cardsEl.innerHTML = '<div class="info-box">No scan data yet.</div>';
    }

    // Verdict breakdown bars
    const verdictColors = { GREEN: "#16a34a", RED: "#dc2626", ORANGE: "#ea580c", YELLOW: "#ca8a04", UNKNOWN: "#94a3b8" };
    const maxVerdict = Math.max(...verdicts.map(v => v.count), 1);
    const vEl = document.getElementById("verdictBreakdown");
    vEl.innerHTML = verdicts.length ? verdicts.map(v => `
      <div class="breakdown-item">
        <span class="breakdown-label verdict-${v.status}">${v.status}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar" style="width:${(v.count / maxVerdict * 100).toFixed(1)}%;background:${verdictColors[v.status] || '#94a3b8'};"></div>
        </div>
        <span class="breakdown-count">${fmt(v.count)}</span>
      </div>
    `).join("") : '<div class="info-box">No verdict data.</div>';

    // Geo breakdown bars
    const maxGeo = Math.max(...geo.map(g => g.count), 1);
    const gEl = document.getElementById("scanGeoList");
    gEl.innerHTML = geo.length ? geo.map(g => `
      <div class="breakdown-item">
        <span class="breakdown-label">${esc(g.country)}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar" style="width:${(g.count / maxGeo * 100).toFixed(1)}%;background:var(--brand);"></div>
        </div>
        <span class="breakdown-count">${fmt(g.count)}</span>
      </div>
    `).join("") : '<div class="info-box">No geographic data.</div>';

    // Top scanned table
    const topRows = topScanned.map(p => ({
      product: p.product_name || "Unknown",
      brand: p.brand || "",
      barcode: p.barcode,
      status: p.status || "",
      scans: p.scans,
    }));
    const tbody = document.querySelector("#topScannedTable tbody");
    if (!topRows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px;">No scan data</td></tr>';
    } else {
      tbody.innerHTML = topRows.map(r => `
        <tr>
          <td><strong>${esc(r.product)}</strong></td>
          <td>${esc(r.brand)}</td>
          <td style="font-family:monospace;font-size:12px;color:var(--muted);">${esc(r.barcode)}</td>
          <td>${r.status ? `<span class="status-badge ${r.status === 'GREEN' ? 'active' : r.status === 'RED' ? 'rejected' : 'pending'}" style="text-transform:none;">${r.status}</span>` : ''}</td>
          <td><strong>${fmt(r.scans)}</strong></td>
        </tr>
      `).join("");
    }
  }

  // ── Photos ─────────────────────────────────────────────────────────────
  let _currentPhotos = [];

  async function loadPhotos() {
    const status = document.getElementById("photoStatusFilter").value;
    const container = document.getElementById("photosList");
    container.innerHTML = '<div class="loading"></div>';
    let resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/photos?status=${status}&limit=50`);
    if (!resp.ok) resp = await fetchWithAuth(`${API_BASE}/v1/admin/photos?status=${status}&limit=50`);
    if (resp.ok) {
      const data = await resp.json();
      _currentPhotos = data.submissions || [];
      renderPhotos(_currentPhotos);
    } else {
      container.innerHTML = '<div class="info-box">Failed to load photos.</div>';
    }
  }

  function renderPhotos(photos) {
    const container = document.getElementById("photosList");
    if (!photos.length) {
      container.innerHTML = '<div class="info-box">No photo submissions found.</div>';
      return;
    }
    container.innerHTML = photos.map(p => `
      <div class="photo-card">
        <div class="info">
          <strong>${esc(p.product_name || "Unknown product")}</strong>
          <div class="barcode">${esc(p.barcode)} &bull; ${new Date(p.submitted_at).toLocaleDateString()}${p.submitter_email ? ' &bull; ' + esc(p.submitter_email) : ''}</div>
          <span class="status-badge ${p.review_status}">${p.review_status}</span>
        </div>
        <div class="actions">
          <button class="btn-view" onclick="viewPhoto('${esc(p.id)}')">Review</button>
        </div>
      </div>
    `).join("");
  }

  let _currentPhotoId = null;
  let _currentPhotoB64 = null;

  window.viewPhoto = async function (id) {
    let resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/photos/${id}`);
    if (!resp.ok) resp = await fetchWithAuth(`${API_BASE}/v1/admin/photos/${id}`);
    if (!resp.ok) return alert("Failed to load photo");
    const data = await resp.json();
    _currentPhotoId = id;
    _currentPhotoB64 = data.photo_b64 || "";

    const modal = document.getElementById("photoModal");
    const img = document.getElementById("photoImage");
    const meta = document.getElementById("photoMeta");
    const reviewResult = document.getElementById("reviewResult");
    const noteField = document.getElementById("reviewNote");

    img.src = _currentPhotoB64 ? `data:image/jpeg;base64,${_currentPhotoB64}` : "";
    document.getElementById("photoReviewTitle").textContent = esc(data.product_name || "Unknown Product");

    meta.innerHTML = `
      <p><strong>Barcode:</strong> <span style="font-family:monospace;">${esc(data.barcode)}</span></p>
      <p><strong>Product:</strong> ${esc(data.product_name || "N/A")}</p>
      <p><strong>Submitted:</strong> ${new Date(data.submitted_at).toLocaleString()}</p>
      <p><strong>Status:</strong> <span class="status-badge ${data.review_status}">${data.review_status}</span></p>
      ${data.submitter_email ? `<p><strong>Email:</strong> ${esc(data.submitter_email)}</p>` : ''}
      ${data.reviewer_note ? `<p><strong>Note:</strong> ${esc(data.reviewer_note)}</p>` : ""}
    `;

    // Reset review form
    noteField.value = data.reviewer_note || "";
    reviewResult.style.display = "none";
    const verdictResultEl = document.getElementById("verdictResult");
    if (verdictResultEl) verdictResultEl.style.display = "none";

    // Pre-fill ingredient entry fields from submission data
    const productNameInput = document.getElementById("reviewProductName");
    const brandInput = document.getElementById("reviewBrand");
    const ingredientsInput = document.getElementById("reviewIngredients");
    if (productNameInput) productNameInput.value = data.product_name || "";
    if (brandInput) brandInput.value = data.brand || "";
    if (ingredientsInput) ingredientsInput.value = "";

    document.querySelectorAll(".review-btn").forEach(b => {
      b.classList.remove("active-status");
      b.disabled = false;
      if (b.dataset.status === data.review_status) b.classList.add("active-status");
    });

    modal.style.display = "flex";
  };

  // Review button handlers
  document.querySelectorAll(".review-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!_currentPhotoId) return;
      const status = btn.dataset.status;
      const note = document.getElementById("reviewNote").value.trim();
      const resultEl = document.getElementById("reviewResult");
      const verdictResultEl = document.getElementById("verdictResult");

      // Build payload — include ingredient data when approving
      const body = { status, note };
      if (status === "added") {
        const ingredients = (document.getElementById("reviewIngredients")?.value || "").trim();
        if (!ingredients) {
          resultEl.className = "review-result error";
          resultEl.textContent = "Ingredients are required when approving. Please paste the ingredient list from the photo.";
          resultEl.style.display = "block";
          return;
        }
        body.ingredients_text = ingredients;
        body.product_name = (document.getElementById("reviewProductName")?.value || "").trim();
        body.brand = (document.getElementById("reviewBrand")?.value || "").trim();
        body.profile = document.getElementById("reviewProfile")?.value || "jain";
      }

      // Disable all buttons during request
      document.querySelectorAll(".review-btn").forEach(b => b.disabled = true);

      try {
        let resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/photos/${_currentPhotoId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          resp = await fetchWithAuth(`${API_BASE}/v1/admin/photos/${_currentPhotoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Admin-Key": getAdminKey() },
            body: JSON.stringify(body),
          });
        }

        if (resp.ok) {
          const data = await resp.json();
          resultEl.className = "review-result success";
          const statusLabel = { added: "Approved & Added", reviewed: "Marked as Reviewed", rejected: "Rejected" };
          resultEl.textContent = `${statusLabel[status] || status}${status === "added" ? " — product saved & notification email sent" : ""}`;
          resultEl.style.display = "block";

          // Show verdict details when a product was added
          if (status === "added" && data.verdict && verdictResultEl) {
            const v = data.verdict;
            const verdictColors = { GREEN: "#16a34a", RED: "#dc2626", ORANGE: "#ea580c", YELLOW: "#ca8a04", UNKNOWN: "#94a3b8" };
            const vc = verdictColors[v.status] || "#94a3b8";
            verdictResultEl.innerHTML = `
              <div class="verdict-header" style="color:${vc};">
                &#9679; Verdict: ${esc(v.status)}
              </div>
              <div class="verdict-detail">
                <strong>Product:</strong> ${esc(v.product_name || "—")}<br>
                <strong>Brand:</strong> ${esc(v.brand || "—")}<br>
                <strong>Confidence:</strong> ${esc(v.confidence || "—")}<br>
                <strong>Explanation:</strong> ${esc(v.explain || "—")}<br>
                ${v.reasons && v.reasons.length ? `<strong>Reasons:</strong> ${v.reasons.map(r => esc(String(r).replace(/_/g, " "))).join(", ")}` : ""}
              </div>
            `;
            verdictResultEl.style.display = "block";
          }

          // Update button highlights
          document.querySelectorAll(".review-btn").forEach(b => {
            b.classList.remove("active-status");
            if (b.dataset.status === status) b.classList.add("active-status");
          });
          // Refresh the list behind the modal
          loadPhotos();
        } else {
          const errData = await resp.json().catch(() => ({}));
          resultEl.className = "review-result error";
          resultEl.textContent = errData.detail || errData.error || "Failed to update status. Please try again.";
          resultEl.style.display = "block";
          if (verdictResultEl) verdictResultEl.style.display = "none";
        }
      } catch (e) {
        resultEl.className = "review-result error";
        resultEl.textContent = "Connection error.";
        resultEl.style.display = "block";
      } finally {
        document.querySelectorAll(".review-btn").forEach(b => b.disabled = false);
      }
    });
  });

  // Download single photo
  document.getElementById("downloadPhotoBtn")?.addEventListener("click", () => {
    if (!_currentPhotoB64) return;
    const a = document.createElement("a");
    a.href = `data:image/jpeg;base64,${_currentPhotoB64}`;
    a.download = `jaini-photo-${_currentPhotoId || "unknown"}.jpg`;
    a.click();
  });

  // Bulk download all visible photos
  document.getElementById("bulkDownloadBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("bulkDownloadBtn");
    if (!_currentPhotos.length) return alert("No photos to download.");
    btn.disabled = true;
    btn.textContent = "Downloading...";

    let downloaded = 0;
    for (const p of _currentPhotos) {
      try {
        let resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/photos/${p.id}`);
        if (!resp.ok) resp = await fetchWithAuth(`${API_BASE}/v1/admin/photos/${p.id}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.photo_b64) {
            const a = document.createElement("a");
            a.href = `data:image/jpeg;base64,${data.photo_b64}`;
            a.download = `jaini-${data.barcode || "unknown"}-${p.id.slice(0, 8)}.jpg`;
            a.click();
            downloaded++;
            btn.textContent = `Downloading ${downloaded}/${_currentPhotos.length}...`;
            // Small delay to avoid overwhelming the browser
            await new Promise(r => setTimeout(r, 300));
          }
        }
      } catch (e) { console.error("Failed to download photo", p.id, e); }
    }
    btn.textContent = `Downloaded ${downloaded} photos`;
    setTimeout(() => { btn.textContent = "Download All Photos"; btn.disabled = false; }, 3000);
  });

  document.getElementById("closePhotoModal")?.addEventListener("click", () => {
    document.getElementById("photoModal").style.display = "none";
    _currentPhotoId = null;
    _currentPhotoB64 = null;
  });
  document.getElementById("refreshPhotos")?.addEventListener("click", loadPhotos);
  document.getElementById("photoStatusFilter")?.addEventListener("change", loadPhotos);

  // ── Email Tab ──────────────────────────────────────────────────────────
  let _emailSubscribers = [];

  async function loadEmailTab() {
    // Metrics already loaded — just need subscriber list
    try {
      const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/emails`);
      if (resp.ok) {
        const data = await resp.json();
        _emailSubscribers = data.subscribers || [];
        renderEmailSubscribers(_emailSubscribers);
        setText("m-totalEmailUsers", fmt(_emailSubscribers.length));
      }
    } catch (e) { console.error("Failed to load email subscribers:", e); }
  }

  function renderEmailSubscribers(subs) {
    const tbody = document.querySelector("#emailSubscribersTable tbody");
    if (!subs.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:32px;">No users with email yet.</td></tr>';
      return;
    }
    tbody.innerHTML = subs.map(s => `
      <tr>
        <td><div class="user-cell">${s.avatar_url ? `<img class="user-row-avatar" src="${esc(s.avatar_url)}" alt="">` : ''}<span>${esc(s.display_name || "—")}</span></div></td>
        <td>${esc(s.email)}</td>
        <td><span class="status-badge ${s.provider === 'google.com' ? 'active' : 'prospect'}">${esc((s.provider || "unknown").replace(".com", ""))}</span></td>
        <td><span class="digest-badge ${s.weekly_digest ? 'on' : 'off'}">${s.weekly_digest ? 'Subscribed' : 'Not opted in'}</span></td>
        <td>${s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
        <td>${s.last_login ? new Date(s.last_login).toLocaleDateString() : '—'}</td>
      </tr>
    `).join("");
  }

  document.getElementById("exportEmailsBtn")?.addEventListener("click", () => {
    if (!_emailSubscribers.length) return alert("No subscribers to export.");
    const headers = ["email", "display_name", "provider", "weekly_digest", "created_at", "last_login"];
    const csv = [headers.join(","), ..._emailSubscribers.map(s =>
      headers.map(h => `"${(s[h] ?? "").toString().replace(/"/g, '""')}"`).join(",")
    )].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `jaini-email-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Brands CRM ─────────────────────────────────────────────────────────
  async function loadBrands() {
    const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/brands`);
    if (!resp.ok) return;
    const data = await resp.json();
    renderBrands(data.brands || []);
  }

  function renderBrands(brands) {
    const tbody = document.querySelector("#brandsTable tbody");
    if (!brands.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:32px;">No brands yet. Click "+ Add Brand" to get started.</td></tr>';
      return;
    }
    tbody.innerHTML = brands.map(b => `
      <tr>
        <td><strong>${esc(b.brand_name)}</strong></td>
        <td>${esc(b.category || "")}</td>
        <td><span class="status-badge ${b.status}">${b.status}</span></td>
        <td>${esc(b.contact_email || "")}</td>
        <td>
          <button class="btn-edit" onclick="editBrand(${b.id})">Edit</button>
          <button class="btn-danger" onclick="deleteBrand(${b.id})">Delete</button>
        </td>
      </tr>
    `).join("");
    window._brands = brands;
  }

  document.getElementById("addBrandBtn")?.addEventListener("click", () => {
    document.getElementById("brandForm").reset();
    document.getElementById("brandId").value = "";
    document.getElementById("brandModalTitle").textContent = "Add Brand";
    document.getElementById("brandModal").style.display = "flex";
  });
  document.getElementById("cancelBrandBtn")?.addEventListener("click", () => {
    document.getElementById("brandModal").style.display = "none";
  });

  window.editBrand = function (id) {
    const b = (window._brands || []).find(x => x.id === id);
    if (!b) return;
    document.getElementById("brandId").value = b.id;
    document.getElementById("brandName").value = b.brand_name;
    document.getElementById("brandCategory").value = b.category || "";
    document.getElementById("brandEmail").value = b.contact_email || "";
    document.getElementById("brandWebsite").value = b.website || "";
    document.getElementById("brandStatus").value = b.status;
    document.getElementById("brandAffiliate").value = b.affiliate_link || "";
    document.getElementById("brandNotes").value = b.notes || "";
    document.getElementById("brandModalTitle").textContent = "Edit Brand";
    document.getElementById("brandModal").style.display = "flex";
  };

  window.deleteBrand = async function (id) {
    if (!confirm("Delete this brand?")) return;
    await fetchWithAuth(`${API_BASE}/v1/dashboard/brands/${id}`, { method: "DELETE" });
    loadBrands();
  };

  document.getElementById("brandForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      brand_name: document.getElementById("brandName").value,
      category: document.getElementById("brandCategory").value,
      contact_email: document.getElementById("brandEmail").value,
      website: document.getElementById("brandWebsite").value,
      status: document.getElementById("brandStatus").value,
      affiliate_link: document.getElementById("brandAffiliate").value,
      notes: document.getElementById("brandNotes").value,
    };
    const id = document.getElementById("brandId").value;
    if (id) data.id = parseInt(id);
    await fetchWithAuth(`${API_BASE}/v1/dashboard/brands`, { method: "POST", body: JSON.stringify(data) });
    document.getElementById("brandModal").style.display = "none";
    loadBrands();
  });

  document.getElementById("exportBrandsBtn")?.addEventListener("click", () => {
    const brands = window._brands || [];
    if (!brands.length) return alert("No brands to export");
    const headers = ["brand_name", "category", "status", "contact_email", "website", "affiliate_link", "notes"];
    const csv = [headers.join(","), ...brands.map(b =>
      headers.map(h => `"${(b[h] || "").toString().replace(/"/g, '""')}"`).join(",")
    )].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `jaini-brands-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Placements ─────────────────────────────────────────────────────────
  async function loadPlacements() {
    const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/placements`);
    if (!resp.ok) return;
    const data = await resp.json();
    renderPlacements(data.placements || []);
  }

  function renderPlacements(placements) {
    const tbody = document.querySelector("#placementsTable tbody");
    if (!placements.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:32px;">No placements yet.</td></tr>';
      return;
    }
    tbody.innerHTML = placements.map(p => `
      <tr>
        <td>${esc(p.name)}</td>
        <td>${esc(p.product_name)}</td>
        <td>${esc(p.placement_type)}</td>
        <td>${p.target_status || "All"}</td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
        <td>
          <button class="btn-edit" onclick="editPlacement(${p.id})">Edit</button>
          <button class="btn-danger" onclick="deletePlacement(${p.id})">Delete</button>
        </td>
      </tr>
    `).join("");
    window._placements = placements;
  }

  document.getElementById("addPlacementBtn")?.addEventListener("click", () => {
    document.getElementById("placementForm").reset();
    document.getElementById("placementId").value = "";
    document.getElementById("placementModalTitle").textContent = "Add Placement";
    document.getElementById("placementModal").style.display = "flex";
  });
  document.getElementById("cancelPlacementBtn")?.addEventListener("click", () => {
    document.getElementById("placementModal").style.display = "none";
  });

  window.editPlacement = function (id) {
    const p = (window._placements || []).find(x => x.id === id);
    if (!p) return;
    document.getElementById("placementId").value = p.id;
    document.getElementById("placementName").value = p.name;
    document.getElementById("placementProductName").value = p.product_name;
    document.getElementById("placementBrand").value = p.brand || "";
    document.getElementById("placementUrl").value = p.affiliate_url;
    document.getElementById("placementImage").value = p.image_url || "";
    document.getElementById("placementCta").value = p.cta_text || "View Product";
    document.getElementById("placementDisclosure").value = p.disclosure || "Sponsored";
    document.getElementById("placementTarget").value = p.target_status || "";
    document.getElementById("placementType").value = p.placement_type;
    document.getElementById("placementCategory").value = p.category || "";
    document.getElementById("placementPriority").value = p.priority;
    document.getElementById("placementStatus").value = p.status;
    document.getElementById("placementModalTitle").textContent = "Edit Placement";
    document.getElementById("placementModal").style.display = "flex";
  };

  window.deletePlacement = async function (id) {
    if (!confirm("Delete this placement?")) return;
    await fetchWithAuth(`${API_BASE}/v1/dashboard/placements/${id}`, { method: "DELETE" });
    loadPlacements();
  };

  document.getElementById("placementForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById("placementName").value,
      product_name: document.getElementById("placementProductName").value,
      brand: document.getElementById("placementBrand").value,
      affiliate_url: document.getElementById("placementUrl").value,
      image_url: document.getElementById("placementImage").value,
      cta_text: document.getElementById("placementCta").value,
      disclosure: document.getElementById("placementDisclosure").value,
      target_status: document.getElementById("placementTarget").value || null,
      placement_type: document.getElementById("placementType").value,
      category: document.getElementById("placementCategory").value,
      priority: parseInt(document.getElementById("placementPriority").value) || 50,
      status: document.getElementById("placementStatus").value,
    };
    const id = document.getElementById("placementId").value;
    if (id) data.id = parseInt(id);
    await fetchWithAuth(`${API_BASE}/v1/dashboard/placements`, { method: "POST", body: JSON.stringify(data) });
    document.getElementById("placementModal").style.display = "none";
    loadPlacements();
  });

  // ── Users Tab ────────────────────────────────────────────────────────
  let _usersData = [];

  let _usersOffset = 0;
  const USERS_PAGE_SIZE = 200;

  async function loadUsers(append = false) {
    const tbody = document.querySelector("#usersTable tbody");
    if (!append) {
      _usersOffset = 0;
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:32px;"><div class="loading"></div></td></tr>';
    }
    try {
      const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/users?limit=${USERS_PAGE_SIZE}&offset=${_usersOffset}`);
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      const users = data.users || [];
      if (append) {
        _usersData = _usersData.concat(users);
        appendUserRows(users);
      } else {
        _usersData = users;
        renderUsers(_usersData);
      }
      _usersOffset += users.length;
      const total = data.total ?? _usersData.length;
      setText("usersCount", `${_usersData.length} of ${total} users`);
      // Show/hide load more
      const loadMoreWrap = document.getElementById("usersLoadMore");
      if (loadMoreWrap) loadMoreWrap.style.display = _usersData.length < total ? "" : "none";
    } catch (e) {
      if (!append) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:32px;">Failed to load users.</td></tr>';
    }
  }

  function appendUserRows(users) {
    const tbody = document.querySelector("#usersTable tbody");
    users.forEach(u => {
      tbody.insertAdjacentHTML("beforeend", userRowHtml(u));
    });
  }

  function userRowHtml(u) {
    return `
      <tr class="user-row-clickable" data-user-id="${u.id}">
        <td><div class="user-cell">${u.avatar_url ? `<img class="user-row-avatar" src="${esc(u.avatar_url)}" alt="">` : '<span class="user-row-avatar-placeholder">?</span>'}<strong>${esc(u.display_name || "Unknown")}</strong></div></td>
        <td>${esc(u.email || "\u2014")}</td>
        <td><span class="status-badge ${u.provider === 'google.com' ? 'active' : 'prospect'}">${esc((u.provider || "unknown").replace(".com", ""))}</span></td>
        <td><span class="status-badge ${u.role === 'admin' ? 'reviewed' : 'prospect'}">${esc(u.role)}</span></td>
        <td><strong>${fmt(u.scan_count)}</strong></td>
        <td>${fmt(u.search_count)}</td>
        <td>${fmt(u.favorites_count)}</td>
        <td>${esc(u.last_scan_country || "\u2014")}</td>
        <td><span class="digest-badge ${u.weekly_digest ? 'on' : 'off'}">${u.weekly_digest ? 'Yes' : 'No'}</span></td>
        <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '\u2014'}</td>
        <td>${u.last_login ? new Date(u.last_login).toLocaleDateString() : '\u2014'}</td>
      </tr>`;
  }

  function renderUsers(users) {
    const tbody = document.querySelector("#usersTable tbody");
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:32px;">No users found.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(u => userRowHtml(u)).join("");
  }

  // User row click handler
  document.querySelector("#usersTable")?.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-user-id]");
    if (!row) return;
    const userId = row.dataset.userId;
    if (userId) openUserDetail(parseInt(userId));
  });

  let _currentUserDetail = null;
  let _currentUserTab = "scans";

  async function openUserDetail(userId) {
    const modal = document.getElementById("userModal");
    const header = document.getElementById("userDetailHeader");
    const stats = document.getElementById("userDetailStats");
    const content = document.getElementById("userDetailContent");
    header.innerHTML = '<div class="loading"></div>';
    stats.innerHTML = "";
    content.innerHTML = "";
    modal.style.display = "flex";

    try {
      const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/users/${userId}`);
      if (!resp.ok) throw new Error("Failed");
      _currentUserDetail = await resp.json();
      renderUserDetail();
    } catch (e) {
      header.innerHTML = '<div class="info-box">Failed to load user details.</div>';
    }
  }

  function renderUserDetail() {
    const u = _currentUserDetail;
    if (!u) return;
    const header = document.getElementById("userDetailHeader");
    const stats = document.getElementById("userDetailStats");

    header.innerHTML = `
      <div class="user-detail-avatar-row">
        ${u.avatar_url ? `<img class="user-detail-avatar" src="${esc(u.avatar_url)}" alt="">` : '<div class="user-detail-avatar-placeholder">?</div>'}
        <div>
          <h3>${esc(u.display_name || "Unknown User")}</h3>
          <p class="user-detail-email">${esc(u.email || "No email")}</p>
          <div class="user-detail-badges">
            <span class="status-badge ${u.provider === 'google.com' ? 'active' : 'prospect'}">${esc((u.provider || "unknown").replace(".com", ""))}</span>
            <span class="status-badge ${u.role === 'admin' ? 'reviewed' : 'prospect'}">${esc(u.role)}</span>
            <span class="digest-badge ${u.weekly_digest ? 'on' : 'off'}">${u.weekly_digest ? 'Digest: On' : 'Digest: Off'}</span>
          </div>
        </div>
      </div>
    `;

    stats.innerHTML = `
      <div class="user-stat-grid">
        <div class="user-stat"><div class="user-stat-value">${fmt(u.scan_count)}</div><div class="user-stat-label">Scans</div></div>
        <div class="user-stat"><div class="user-stat-value">${fmt(u.search_count)}</div><div class="user-stat-label">Searches</div></div>
        <div class="user-stat"><div class="user-stat-value">${fmt(u.favorites_count)}</div><div class="user-stat-label">Favorites</div></div>
        <div class="user-stat"><div class="user-stat-value">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '\u2014'}</div><div class="user-stat-label">Joined</div></div>
        <div class="user-stat"><div class="user-stat-value">${u.last_login ? new Date(u.last_login).toLocaleDateString() : '\u2014'}</div><div class="user-stat-label">Last Active</div></div>
      </div>
    `;
    renderUserActivityTab(_currentUserTab);
  }

  function renderUserActivityTab(tab) {
    _currentUserTab = tab;
    const u = _currentUserDetail;
    if (!u) return;
    const content = document.getElementById("userDetailContent");

    // Update tab button states
    document.querySelectorAll(".user-tab-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.utab === tab);
    });

    if (tab === "scans") {
      const scans = u.recent_scans || [];
      if (!scans.length) { content.innerHTML = '<div class="info-box">No recent scans.</div>'; return; }
      content.innerHTML = `<table class="data-table"><thead><tr><th>Product</th><th>Barcode</th><th>Outcome</th><th>Verdict</th><th>Country</th><th>Time</th></tr></thead><tbody>
        ${scans.map(s => `<tr>
          <td>${esc(s.product_name || "Unknown")}</td>
          <td style="font-family:monospace;font-size:12px;">${esc(s.barcode || "\u2014")}</td>
          <td><span class="status-badge ${s.outcome === 'hit' ? 'active' : 'pending'}">${esc(s.outcome)}</span></td>
          <td>${s.verdict_status ? `<span class="verdict-${s.verdict_status}">${s.verdict_status}</span>` : '\u2014'}</td>
          <td>${esc(s.country || "\u2014")}</td>
          <td>${s.ts ? new Date(s.ts).toLocaleString() : '\u2014'}</td>
        </tr>`).join("")}
      </tbody></table>`;
    } else if (tab === "favorites") {
      const favs = u.favorites || [];
      if (!favs.length) { content.innerHTML = '<div class="info-box">No favorites.</div>'; return; }
      content.innerHTML = `<table class="data-table"><thead><tr><th>Product</th><th>Brand</th><th>Barcode</th><th>Added</th></tr></thead><tbody>
        ${favs.map(f => `<tr>
          <td><strong>${esc(f.product_name || "Unknown")}</strong></td>
          <td>${esc(f.brand || "\u2014")}</td>
          <td style="font-family:monospace;font-size:12px;">${esc(f.barcode)}</td>
          <td>${f.created_at ? new Date(f.created_at).toLocaleString() : '\u2014'}</td>
        </tr>`).join("")}
      </tbody></table>`;
    } else if (tab === "searches") {
      const searches = u.recent_searches || [];
      if (!searches.length) { content.innerHTML = '<div class="info-box">No recent searches.</div>'; return; }
      content.innerHTML = `<table class="data-table"><thead><tr><th>Query</th><th>Results</th><th>Clicked</th><th>Time</th></tr></thead><tbody>
        ${searches.map(s => `<tr>
          <td><strong>${esc(s.query)}</strong></td>
          <td>${s.results_count}</td>
          <td style="font-family:monospace;font-size:12px;">${esc(s.clicked_barcode || "\u2014")}</td>
          <td>${s.ts ? new Date(s.ts).toLocaleString() : '\u2014'}</td>
        </tr>`).join("")}
      </tbody></table>`;
    } else if (tab === "top") {
      const top = u.most_scanned || [];
      if (!top.length) { content.innerHTML = '<div class="info-box">No scan data.</div>'; return; }
      content.innerHTML = `<table class="data-table"><thead><tr><th>Product</th><th>Brand</th><th>Barcode</th><th>Scans</th></tr></thead><tbody>
        ${top.map(p => `<tr>
          <td><strong>${esc(p.product_name || "Unknown")}</strong></td>
          <td>${esc(p.brand || "\u2014")}</td>
          <td style="font-family:monospace;font-size:12px;">${esc(p.barcode)}</td>
          <td><strong>${fmt(p.scans)}</strong></td>
        </tr>`).join("")}
      </tbody></table>`;
    }
  }

  // User detail tab switching
  document.querySelector(".user-detail-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".user-tab-btn");
    if (!btn) return;
    renderUserActivityTab(btn.dataset.utab);
  });

  document.getElementById("closeUserModal")?.addEventListener("click", () => {
    document.getElementById("userModal").style.display = "none";
    _currentUserDetail = null;
  });
  document.getElementById("refreshUsersBtn")?.addEventListener("click", () => loadUsers(false));
  document.getElementById("loadMoreUsersBtn")?.addEventListener("click", () => loadUsers(true));

  // ── Reports Tab ─────────────────────────────────────────────────────────
  let _reportsData = [];
  let _currentReportId = null;

  async function loadReports() {
    const status = document.getElementById("reportStatusFilter").value;
    const container = document.getElementById("reportsList");
    container.innerHTML = '<div class="loading"></div>';
    try {
      const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/classification-reports?status=${status}&limit=100`);
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      _reportsData = data.reports || [];
      setText("reportsPendingCount", `${data.pending_count || 0} pending`);
      renderReports(_reportsData);
    } catch (e) {
      container.innerHTML = '<div class="info-box">Failed to load reports.</div>';
    }
  }

  function renderReports(reports) {
    const container = document.getElementById("reportsList");
    if (!reports.length) {
      container.innerHTML = '<div class="info-box">No classification reports found.</div>';
      return;
    }
    container.innerHTML = reports.map(r => `
      <div class="photo-card">
        <div class="info">
          <strong>${esc(r.barcode)}</strong>
          <div class="barcode">${esc(r.what_wrong || "").substring(0, 100)}${(r.what_wrong || "").length > 100 ? "..." : ""}</div>
          <div class="barcode">${r.reporter_email ? esc(r.reporter_email) + ' \u2022 ' : ''}${r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</div>
          <span class="status-badge ${r.status === 'pending' ? 'pending' : r.status === 'resolved' ? 'active' : r.status === 'dismissed' ? 'rejected' : 'reviewed'}">${r.status}</span>
        </div>
        <div class="actions">
          <button class="btn-view" onclick="viewReport(${r.id})">Review</button>
        </div>
      </div>
    `).join("");
  }

  window.viewReport = function (id) {
    const r = _reportsData.find(x => x.id === id);
    if (!r) return;
    _currentReportId = id;
    const meta = document.getElementById("reportMeta");
    const modal = document.getElementById("reportModal");
    const resultEl = document.getElementById("reportResult");
    resultEl.style.display = "none";

    document.getElementById("reportModalTitle").textContent = "Report: " + r.barcode;
    document.getElementById("reportReviewerNote").value = r.reviewer_note || "";
    meta.innerHTML = `
      <p><strong>Barcode:</strong> <span style="font-family:monospace;">${esc(r.barcode)}</span></p>
      <p><strong>Profile:</strong> ${esc(r.profile || "jain")}</p>
      <p><strong>What's Wrong:</strong> ${esc(r.what_wrong)}</p>
      ${r.corrected_ingredients ? `<p><strong>Corrected Ingredients:</strong> ${esc(r.corrected_ingredients)}</p>` : ''}
      ${r.reporter_email ? `<p><strong>Reporter:</strong> ${esc(r.reporter_email)}</p>` : ''}
      <p><strong>Status:</strong> <span class="status-badge ${r.status === 'pending' ? 'pending' : r.status === 'resolved' ? 'active' : 'rejected'}">${r.status}</span></p>
      <p><strong>Submitted:</strong> ${r.created_at ? new Date(r.created_at).toLocaleString() : '\u2014'}</p>
      ${r.reviewed_at ? `<p><strong>Reviewed:</strong> ${new Date(r.reviewed_at).toLocaleString()}</p>` : ''}
    `;
    modal.style.display = "flex";
  };

  async function updateReport(status) {
    if (!_currentReportId) return;
    const note = document.getElementById("reportReviewerNote").value.trim();
    const resultEl = document.getElementById("reportResult");
    try {
      const resp = await fetchWithAuth(`${API_BASE}/v1/dashboard/classification-reports/${_currentReportId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: status, reviewer_note: note }),
      });
      if (resp.ok) {
        resultEl.className = "review-result success";
        resultEl.textContent = "Report marked as " + status + ".";
        resultEl.style.display = "block";
        loadReports();
      } else {
        const err = await resp.json().catch(() => ({}));
        resultEl.className = "review-result error";
        resultEl.textContent = err.message || err.error || "Failed to update.";
        resultEl.style.display = "block";
      }
    } catch (e) {
      resultEl.className = "review-result error";
      resultEl.textContent = "Connection error.";
      resultEl.style.display = "block";
    }
  }

  document.getElementById("reportResolveBtn")?.addEventListener("click", () => updateReport("resolved"));
  document.getElementById("reportDismissBtn")?.addEventListener("click", () => updateReport("dismissed"));
  document.getElementById("closeReportModal")?.addEventListener("click", () => {
    document.getElementById("reportModal").style.display = "none";
    _currentReportId = null;
  });
  document.getElementById("refreshReportsBtn")?.addEventListener("click", loadReports);
  document.getElementById("reportStatusFilter")?.addEventListener("change", loadReports);

  // ── Sign out ───────────────────────────────────────────────────────────
  document.getElementById("signOutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("JAINI_ADMIN_KEY");
    location.reload();
  });

  // ── Recent Scans Tab ─────────────────────────────────────────────────
  const RECENT_SCANS_PAGE_SIZE = 200;
  let _recentScansOffset = 0;
  let _recentScansTotal = 0;
  let _recentScansLoading = false;

  async function loadRecentScans(append = false) {
    const tbody = document.querySelector("#recentScansTable tbody");
    const loadMoreWrap = document.getElementById("recentScansLoadMore");
    const loadMoreBtn = document.getElementById("loadMoreScansBtn");

    if (!append) {
      _recentScansOffset = 0;
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;"><div class="loading"></div></td></tr>';
    }
    if (loadMoreBtn) loadMoreBtn.disabled = true;
    _recentScansLoading = true;

    try {
      const resp = await fetchWithAuth(
        `${API_BASE}/v1/admin/recent-scans?limit=${RECENT_SCANS_PAGE_SIZE}&offset=${_recentScansOffset}`
      );
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      const scans = data.scans || [];
      _recentScansTotal = data.total || 0;

      if (append) {
        appendRecentScanRows(scans);
      } else {
        renderRecentScans(scans);
      }

      _recentScansOffset += scans.length;
      setText("recentScansCount", `${_recentScansOffset} of ${fmt(_recentScansTotal)} scans`);

      // Show or hide "Load more" button
      if (loadMoreWrap) {
        loadMoreWrap.style.display = _recentScansOffset < _recentScansTotal ? "block" : "none";
      }
    } catch (e) {
      if (!append) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:32px;">Failed to load recent scans.</td></tr>';
      }
    } finally {
      _recentScansLoading = false;
      if (loadMoreBtn) loadMoreBtn.disabled = false;
    }
  }

  function formatTimeAgo(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return diffMin + "m ago";
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + "h ago";
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return diffDay + "d ago";
    return d.toLocaleDateString();
  }

  function scanRowHtml(s) {
    const statusClass = s.verdict_status === "GREEN" ? "active"
      : s.verdict_status === "RED" ? "rejected"
      : s.verdict_status === "ORANGE" ? "pending"
      : s.verdict_status === "YELLOW" ? "pending"
      : "prospect";
    const location = [s.city, s.country].filter(Boolean).join(", ") || "—";
    const userName = s.user_name || s.user_email || s.client_id || "—";
    return `<tr>
      <td title="${s.ts ? new Date(s.ts).toLocaleString() : ''}">${formatTimeAgo(s.ts)}</td>
      <td>${esc(userName)}</td>
      <td><strong>${esc(s.product_name || "Unknown")}</strong></td>
      <td>${esc(s.brand || "")}</td>
      <td style="font-family:monospace;font-size:12px;color:var(--muted);">${esc(s.barcode || "")}</td>
      <td>${s.verdict_status ? `<span class="status-badge ${statusClass}" style="text-transform:none;">${s.verdict_status}</span>` : `<span class="status-badge prospect" style="text-transform:none;">${esc(s.outcome || "—")}</span>`}</td>
      <td>${s.confidence ? esc(s.confidence) : "—"}</td>
      <td>${esc(s.profile || "")}</td>
      <td>${esc(location)}</td>
      <td>${s.response_ms != null ? s.response_ms + "ms" : "—"}</td>
    </tr>`;
  }

  function renderRecentScans(scans) {
    const tbody = document.querySelector("#recentScansTable tbody");
    if (!scans.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:32px;">No scan data yet.</td></tr>';
      return;
    }
    tbody.innerHTML = scans.map(scanRowHtml).join("");
  }

  function appendRecentScanRows(scans) {
    const tbody = document.querySelector("#recentScansTable tbody");
    tbody.insertAdjacentHTML("beforeend", scans.map(scanRowHtml).join(""));
  }

  document.getElementById("refreshRecentScans")?.addEventListener("click", () => loadRecentScans(false));
  document.getElementById("loadMoreScansBtn")?.addEventListener("click", () => {
    if (!_recentScansLoading) loadRecentScans(true);
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "--";
  }

  function fmt(n) {
    if (n == null) return "--";
    return Number(n).toLocaleString();
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function renderTable(tableId, rows, keys) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${keys.length}" style="text-align:center;color:#94a3b8;padding:24px;">No data</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r =>
      "<tr>" + keys.map(k => `<td>${esc(String(r[k] ?? ""))}</td>`).join("") + "</tr>"
    ).join("");
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  checkSession();
})();
