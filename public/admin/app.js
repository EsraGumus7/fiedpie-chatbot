(() => {
  const state = {
    catalog: { intents: [] },
    subscriptions: [],
    roles: [],
    users: [],
    brands: [],
    clients: [],
    selectedDomain: "all",
    roleCompanyId: null,
    roleId: null,
    userId: null,
  };

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2500);
  }

  function getSelectedValues(selectEl) {
    return Array.from(selectEl.selectedOptions).map((o) => Number(o.value));
  }

  function setSelectedValues(selectEl, values) {
    const set = new Set((values || []).map(Number));
    Array.from(selectEl.options).forEach((o) => {
      o.selected = set.has(Number(o.value));
    });
  }

  function fillSelect(selectEl, items, { valueKey = "id", labelKey = "label", emptyOption } = {}) {
    const parts = [];
    if (emptyOption) {
      parts.push(`<option value="">${emptyOption}</option>`);
    }
    parts.push(
      ...items.map(
        (item) => `<option value="${item[valueKey]}">${item[labelKey] || item.name || item.label}</option>`
      )
    );
    selectEl.innerHTML = parts.join("");
  }

  /* ---------- Navigation ---------- */

  function initNav() {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $(`page-${btn.dataset.page}`).classList.add("active");
        if (btn.dataset.page === "audit") loadAudit();
      });
    });

    $("modeBadge").textContent = AdminApi.USE_MOCK ? "MOCK API" : "LIVE API";
  }

  /* ---------- Catalog & domain tabs ---------- */

  async function loadCatalog() {
    const data = await AdminApi.getCatalog();
    state.catalog.intents = data.intents || [];
    renderDomainTabs();
    renderIntentTable();
  }

  function renderDomainTabs() {
    const domains = ["all", ...new Set(state.catalog.intents.map((i) => i.domain).filter(Boolean))];
    const container = $("domainTabs");
    container.innerHTML = domains
      .map(
        (d) =>
          `<button type="button" class="domain-tab ${d === state.selectedDomain ? "active" : ""}" data-domain="${d}">${
            d === "all" ? "Tümü" : d
          }</button>`
      )
      .join("");

    container.querySelectorAll(".domain-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.selectedDomain = tab.dataset.domain;
        renderDomainTabs();
        renderIntentTable();
      });
    });
  }

  async function renderIntentTable() {
    if (!state.roleId) return;

    const perms = await AdminApi.getRolePermissions(state.roleId);
    const allowed = new Set(perms.allowedIntents || []);
    const isSuper = allowed.has("*");

    const items = state.catalog.intents.filter(
      (i) => state.selectedDomain === "all" || i.domain === state.selectedDomain
    );

    $("intentTableBody").innerHTML = items
      .map((item) => {
        const checked = isSuper || allowed.has(item.intent) ? "checked" : "";
        return `<tr>
          <td><input type="checkbox" data-intent="${item.intent}" ${checked} ${isSuper ? "disabled" : ""} /></td>
          <td>${item.intent}</td>
          <td>${item.metric_id || "-"}</td>
          <td>${item.domain || "-"}</td>
          <td>${item.description_tr || "-"}</td>
        </tr>`;
      })
      .join("");
  }

  /* ---------- Roles page ---------- */

  async function loadSubscriptionsForRoles() {
    const data = await AdminApi.getSubscriptions();
    state.subscriptions = data.items || [];
    fillSelect($("roleCompanySelect"), state.subscriptions, { labelKey: "label", emptyOption: "— Company seç —" });
    if (state.subscriptions.length) {
      state.roleCompanyId = state.subscriptions[0].id;
      $("roleCompanySelect").value = state.roleCompanyId;
    }
    await loadRolesForPage();
  }

  async function loadRolesForPage() {
    const subId = Number($("roleCompanySelect").value) || null;
    state.roleCompanyId = subId;
    const data = await AdminApi.getRoles({ subscriptionId: subId });
    state.roles = data.items || [];
    fillSelect($("roleSelect"), state.roles, { valueKey: "id", labelKey: "name" });
    if (state.roles.length) {
      state.roleId = state.roles[0].id;
      $("roleSelect").value = state.roleId;
    } else {
      state.roleId = null;
    }
    await renderIntentTable();
  }

  async function saveRolePermissions() {
    if (!state.roleId) {
      showToast("Önce rol seçin.");
      return;
    }
    const checkboxes = document.querySelectorAll("#intentTableBody input[type='checkbox']:not(:disabled)");
    const allowedIntents = Array.from(checkboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.intent);

    await AdminApi.saveRolePermissions(state.roleId, allowedIntents);
    showToast("Rol intent izinleri kaydedildi.");
    await renderIntentTable();
  }

  /* ---------- Users page ---------- */

  async function loadUsers() {
    const search = $("userSearch").value;
    const data = await AdminApi.getUsers({ search, limit: 100 });
    state.users = data.items || [];
    fillSelect($("userSelect"), state.users, {
      valueKey: "id",
      labelKey: "name",
    });
    Array.from($("userSelect").options).forEach((opt, idx) => {
      const u = state.users[idx];
      if (u) opt.textContent = `${u.name} (${u.email})`;
    });
    if (state.users.length) {
      state.userId = state.users[0].id;
      $("userSelect").value = state.userId;
    }
    await loadUserDetail();
  }

  async function loadScopeOptions() {
    const dataSub = await AdminApi.getSubscriptions();
    fillSelect($("scopeCompanySelect"), dataSub.items || [], { labelKey: "label" });

    const dataBrand = await AdminApi.getBrands({});
    state.brands = dataBrand.items || [];
    fillSelect($("scopeBrandSelect"), state.brands, { labelKey: "label" });

    const dataClient = await AdminApi.getClients({ limit: 200 });
    state.clients = dataClient.items || [];
    fillSelect($("scopeClientSelect"), state.clients, { labelKey: "label" });
  }

  async function loadUserDetail() {
    const userId = Number($("userSelect").value);
    if (!userId) return;
    state.userId = userId;

    const user = state.users.find((u) => u.id === userId);
    const subId = user?.subscriptionId;

    const rolesData = await AdminApi.getRoles({ subscriptionId: subId });
    fillSelect($("userRoleSelect"), rolesData.items || [], { valueKey: "id", labelKey: "name" });

    const userRoles = await AdminApi.getUserRoles(userId);
    setSelectedValues($("userRoleSelect"), userRoles.roleIds || []);

    const scopes = await AdminApi.getUserScopes(userId);
    setSelectedValues($("scopeCompanySelect"), scopes.allowedSubscriptionIds || []);
    setSelectedValues($("scopeBrandSelect"), scopes.allowedBrandIds || []);
    setSelectedValues($("scopeClientSelect"), scopes.allowedClientIds || []);

    await refreshEffectivePreview();
  }

  async function refreshEffectivePreview() {
    if (!state.userId) return;
    const preview = await AdminApi.getEffectivePermissions(state.userId);
    $("effectivePreview").textContent = JSON.stringify(preview, null, 2);
  }

  async function saveUserSettings() {
    const userId = Number($("userSelect").value);
    if (!userId) {
      showToast("Kullanıcı seçin.");
      return;
    }

    const roleIds = getSelectedValues($("userRoleSelect"));
    const companyIds = getSelectedValues($("scopeCompanySelect"));
    const brandIds = getSelectedValues($("scopeBrandSelect"));
    const clientIds = getSelectedValues($("scopeClientSelect"));

    const scopes = {
      allowedSubscriptionIds: companyIds.length ? companyIds : null,
      allowedBrandIds: brandIds.length ? brandIds : null,
      allowedClientIds: clientIds.length ? clientIds : null,
    };

    await AdminApi.saveUserRoles(userId, roleIds);
    await AdminApi.saveUserScopes(userId, scopes);
    showToast("Kullanıcı ayarları kaydedildi.");
    await refreshEffectivePreview();
  }

  /* ---------- Audit ---------- */

  async function loadAudit() {
    const data = await AdminApi.getAuditLogs(50);
    $("auditTableBody").innerHTML = (data.items || [])
      .map(
        (row) => `<tr>
          <td>${(row.createdAt || row.created_at || "").replace("T", " ").slice(0, 19)}</td>
          <td>${row.actorUserId || row.actor_user_id || "-"}</td>
          <td>${row.action}</td>
          <td>${row.targetType || row.target_type}:${row.targetId || row.target_id}</td>
          <td>${row.summary || row.summary_tr || "-"}</td>
        </tr>`
      )
      .join("");
  }

  /* ---------- Init ---------- */

  function bindEvents() {
    $("roleCompanySelect").addEventListener("change", () => loadRolesForPage());
    $("roleSelect").addEventListener("change", async (e) => {
      state.roleId = Number(e.target.value);
      await renderIntentTable();
    });
    $("saveRoleBtn").addEventListener("click", () => saveRolePermissions().catch((e) => showToast(e.message)));

    $("selectAllIntentsBtn").addEventListener("click", () => {
      document.querySelectorAll("#intentTableBody input[type='checkbox']:not(:disabled)").forEach((cb) => {
        cb.checked = true;
      });
    });
    $("clearIntentsBtn").addEventListener("click", () => {
      document.querySelectorAll("#intentTableBody input[type='checkbox']:not(:disabled)").forEach((cb) => {
        cb.checked = false;
      });
    });

    $("userSearch").addEventListener(
      "input",
      debounce(() => loadUsers().catch((e) => showToast(e.message)), 300)
    );
    $("userSelect").addEventListener("change", () => loadUserDetail().catch((e) => showToast(e.message)));
    $("userRoleSelect").addEventListener("change", () => refreshEffectivePreview());
    ["scopeCompanySelect", "scopeBrandSelect", "scopeClientSelect"].forEach((id) => {
      $(id).addEventListener("change", () => refreshEffectivePreview());
    });
    $("saveUserBtn").addEventListener("click", () => saveUserSettings().catch((e) => showToast(e.message)));
    $("refreshAuditBtn").addEventListener("click", () => loadAudit().catch((e) => showToast(e.message)));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  async function bootstrap() {
    initNav();
    bindEvents();
    await loadCatalog();
    await loadSubscriptionsForRoles();
    await loadScopeOptions();
    await loadUsers();
    await loadAudit();
  }

  bootstrap().catch((err) => {
    showToast(`Başlatma hatası: ${err.message}`);
    console.error(err);
  });
})();
