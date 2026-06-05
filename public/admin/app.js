(() => {
  const state = {
    catalog: { intents: [] },
    subscriptions: [],
    roles: [],
    users: [],
    brands: [],
    clients: [],
    selectedDomain: "all",
    userSelectedDomain: "all",
    roleCompanyId: null,
    roleId: null,
    userId: null,
    scopeSubscriptionId: null,
  };

  const $ = (id) => document.getElementById(id);

  function formatAuditDate(value) {
    if (!value) return "-";
    const text = String(value);
    if (text.includes("T")) return text.replace("T", " ").slice(0, 19);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return text.slice(0, 19);
    return d.toISOString().replace("T", " ").slice(0, 19);
  }

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

  function updateAuthUi() {
    const loggedIn = AdminApi.USE_MOCK || !!AdminApi.getToken();
    $("loginBtn").classList.toggle("hidden", loggedIn);
    $("logoutBtn").classList.toggle("hidden", !loggedIn || AdminApi.USE_MOCK);
    $("loginEmail").disabled = loggedIn;
    $("loginPassword").disabled = loggedIn;
    $("appMain").style.opacity = loggedIn ? "1" : "0.45";
    $("appMain").style.pointerEvents = loggedIn ? "auto" : "none";
  }

  async function handleLogin() {
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    if (!email || !password) {
      showToast("E-posta ve şifre gerekli.");
      return;
    }
    const data = await AdminApi.login(email, password);
    $("loginUserLabel").textContent = data.user?.name || data.user?.email || "Giriş OK";
    $("loginUserLabel").classList.remove("hidden");
    updateAuthUi();
    showToast("Giriş başarılı.");
    await bootstrapData();
  }

  function handleLogout() {
    AdminApi.clearToken();
    $("loginUserLabel").classList.add("hidden");
    updateAuthUi();
    showToast("Çıkış yapıldı.");
  }

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
    if ($("page-audit").classList.contains("active")) await loadAudit();
  }

  function renderUserDomainTabs() {
    const domains = ["all", ...new Set(state.catalog.intents.map((i) => i.domain).filter(Boolean))];
    const container = $("userDomainTabs");
    if (!container) return;
    container.innerHTML = domains
      .map(
        (d) =>
          `<button type="button" class="domain-tab ${d === state.userSelectedDomain ? "active" : ""}" data-domain="${d}">${
            d === "all" ? "Tümü" : d
          }</button>`
      )
      .join("");

    container.querySelectorAll(".domain-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.userSelectedDomain = tab.dataset.domain;
        renderUserDomainTabs();
        renderUserIntentTable();
      });
    });
  }

  async function renderUserIntentTable() {
    if (!state.userId) {
      $("userIntentTableBody").innerHTML = "";
      return;
    }

    const perms = await AdminApi.getUserPermissions(state.userId);
    const allowed = new Set(perms.allowedIntents || []);
    const isSuper = allowed.has("*");
    $("userSuperAdminChk").checked = isSuper;

    const items = state.catalog.intents.filter(
      (i) => state.userSelectedDomain === "all" || i.domain === state.userSelectedDomain
    );

    $("userIntentTableBody").innerHTML = items
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

  function collectUserAllowedIntents() {
    if ($("userSuperAdminChk").checked) return ["*"];
    return Array.from(document.querySelectorAll("#userIntentTableBody input[type='checkbox']:not(:disabled)"))
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.intent);
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

  async function loadScopeOptions(subscriptionId = null) {
    const subId = subscriptionId || state.scopeSubscriptionId || null;
    state.scopeSubscriptionId = subId;

    const dataSub = await AdminApi.getSubscriptions();
    fillSelect($("scopeCompanySelect"), dataSub.items || [], { labelKey: "label" });

    const dataCountry = await AdminApi.getCountries({ limit: 200 });
    fillSelect($("scopeCountrySelect"), dataCountry.items || [], { labelKey: "label" });

    const dataTeam = await AdminApi.getTeams(subId ? { subscriptionId: subId } : {});
    fillSelect($("scopeTeamSelect"), dataTeam.items || [], { labelKey: "label" });

    const dataBrand = await AdminApi.getBrands(subId ? { subscriptionId: subId } : {});
    state.brands = dataBrand.items || [];
    fillSelect($("scopeBrandSelect"), state.brands, { labelKey: "label" });
  }

  function updateSelectedUserHint() {
    const userId = Number($("userSelect").value);
    const user = state.users.find((u) => u.id === userId);
    const el = $("selectedUserHint");
    if (!el) return;
    if (!user) {
      el.textContent = "Kullanıcı seçin.";
      return;
    }
    el.textContent = `Seçili: ${user.name} (${user.email}) — UserId #${user.id}. Chat'te bu kullanıcı ile giriş yapın.`;
  }

  async function loadUserDetail() {
    const userId = Number($("userSelect").value);
    if (!userId) return;
    state.userId = userId;
    updateSelectedUserHint();

    const user = state.users.find((u) => u.id === userId);
    const subId = user?.subscriptionId;
    state.scopeSubscriptionId = subId || null;
    await loadScopeOptions(subId);

    const rolesData = await AdminApi.getRoles({ subscriptionId: subId });
    fillSelect($("userRoleSelect"), rolesData.items || [], { valueKey: "id", labelKey: "name" });

    const userRoles = await AdminApi.getUserRoles(userId);
    setSelectedValues($("userRoleSelect"), userRoles.roleIds || []);

    const scopes = await AdminApi.getUserScopes(userId);
    setSelectedValues($("scopeCompanySelect"), scopes.allowedSubscriptionIds || []);
    setSelectedValues($("scopeCountrySelect"), scopes.allowedCountryIds || []);
    setSelectedValues($("scopeTeamSelect"), scopes.allowedTeamIds || []);
    setSelectedValues($("scopeBrandSelect"), scopes.allowedBrandIds || []);

    renderUserDomainTabs();
    await renderUserIntentTable();
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
    const countryIds = getSelectedValues($("scopeCountrySelect"));
    const teamIds = getSelectedValues($("scopeTeamSelect"));
    const brandIds = getSelectedValues($("scopeBrandSelect"));

    const scopes = {
      allowedSubscriptionIds: companyIds.length ? companyIds : null,
      allowedCountryIds: countryIds.length ? countryIds : null,
      allowedTeamIds: teamIds.length ? teamIds : null,
      allowedBrandIds: brandIds.length ? brandIds : null,
    };

    const allowedIntents = collectUserAllowedIntents();

    await AdminApi.saveUserRoles(userId, roleIds);
    await AdminApi.saveUserPermissions(userId, allowedIntents);
    await AdminApi.saveUserScopes(userId, scopes);
    showToast("Kullanıcı ayarları kaydedildi.");
    await refreshEffectivePreview();
    if ($("page-audit").classList.contains("active")) await loadAudit();
  }

  /* ---------- Audit ---------- */

  async function loadAudit() {
    const data = await AdminApi.getAuditLogs(50);
    $("auditTableBody").innerHTML = (data.items || [])
      .map(
        (row) => `<tr>
          <td>${formatAuditDate(row.createdAt || row.created_at)}</td>
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
    ["scopeCompanySelect", "scopeCountrySelect", "scopeTeamSelect", "scopeBrandSelect"].forEach((id) => {
      $(id).addEventListener("change", () => refreshEffectivePreview());
    });
    $("scopeCompanySelect").addEventListener("change", () => {
      const ids = getSelectedValues($("scopeCompanySelect"));
      const subId = ids[0] || state.scopeSubscriptionId;
      loadScopeOptions(subId || null).catch((e) => showToast(e.message));
    });
    $("saveUserBtn").addEventListener("click", () => saveUserSettings().catch((e) => showToast(e.message)));

    $("selectAllUserIntentsBtn").addEventListener("click", () => {
      $("userSuperAdminChk").checked = false;
      document.querySelectorAll("#userIntentTableBody input[type='checkbox']").forEach((cb) => {
        cb.disabled = false;
        cb.checked = true;
      });
    });
    $("clearUserIntentsBtn").addEventListener("click", () => {
      $("userSuperAdminChk").checked = false;
      document.querySelectorAll("#userIntentTableBody input[type='checkbox']").forEach((cb) => {
        cb.disabled = false;
        cb.checked = false;
      });
    });
    $("userSuperAdminChk").addEventListener("change", (e) => {
      const isSuper = e.target.checked;
      document.querySelectorAll("#userIntentTableBody input[type='checkbox']").forEach((cb) => {
        cb.disabled = isSuper;
        if (isSuper) cb.checked = true;
      });
    });

    $("refreshAuditBtn").addEventListener("click", () => loadAudit().catch((e) => showToast(e.message)));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  async function bootstrapData() {
    await loadCatalog();
    renderUserDomainTabs();
    await loadSubscriptionsForRoles();
    await loadScopeOptions();
    await loadUsers();
    await loadAudit();
  }

  async function bootstrap() {
    initNav();
    bindEvents();
    $("loginBtn").addEventListener("click", () => handleLogin().catch((e) => showToast(e.message)));
    $("logoutBtn").addEventListener("click", handleLogout);
    updateAuthUi();

    if (AdminApi.USE_MOCK || AdminApi.getToken()) {
      await bootstrapData();
    }
  }

  bootstrap().catch((err) => {
    showToast(`Başlatma hatası: ${err.message}`);
    console.error(err);
  });
})();
