/**
 * Admin API katmanı.
 * Kişi 2 endpoint'leri hazır olunca USE_MOCK = false yap; fetch URL'leri aynı kalır.
 */
const AdminApi = (() => {
  const USE_MOCK = false;
  const STORAGE_KEY = "admin_panel_state_v1";
  const TOKEN_KEY = "admin_jwt_token";
  const API_BASE = "/api/admin";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_e) {
      /* noop */
    }
    return {
      rolePermissions: { ...(window.ADMIN_MOCK_SEED?.rolePermissions || {}) },
      userPermissions: { ...(window.ADMIN_MOCK_SEED?.userPermissions || {}) },
      userRoles: { ...(window.ADMIN_MOCK_SEED?.userRoles || {}) },
      userScopes: { ...(window.ADMIN_MOCK_SEED?.userScopes || {}) },
      auditLogs: [...(window.ADMIN_MOCK_SEED?.auditLogs || [])],
    };
  }

  function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function mapIntentDomain(intent, metricId = "") {
    const text = `${intent || ""} ${metricId || ""}`.toLowerCase();
    if (text.includes("visit") || text.includes("dynamic")) return "visit";
    if (text.includes("user")) return "users";
    if (text.includes("client") || text.includes("distributor") || text.includes("consumer")) return "client";
    if (
      text.includes("invoice") ||
      text.includes("purchase") ||
      text.includes("campaign") ||
      text.includes("sales") ||
      text.includes("payment")
    )
      return "sales";
    return "other";
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: authHeaders(options.headers || {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function filterSearch(items, search, fields) {
    const q = String(search || "")
      .trim()
      .toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      fields.some((f) => String(item[f] || "").toLowerCase().includes(q))
    );
  }

  function pushAudit(state, entry) {
    const nextId = (state.auditLogs[state.auditLogs.length - 1]?.id || 0) + 1;
    state.auditLogs.unshift({
      id: nextId,
      createdAt: new Date().toISOString(),
      ...entry,
    });
  }

  /* ---------- MOCK ---------- */

  async function mockGetCatalog() {
    try {
      const planner = await fetchJson("/api/planner/metrics");
      const intents = (planner.metrics || []).map((m) => ({
        intent: m.intent,
        metric_id: m.metric_id,
        description_tr: m.description_tr || "",
        domain: mapIntentDomain(m.intent, m.metric_id),
      }));
      if (intents.length) return { intents };
    } catch (_e) {
      /* sunucu kapalıysa fallback */
    }
    return { intents: window.ADMIN_MOCK_SEED.fallbackIntents };
  }

  async function mockGetSubscriptions(search) {
    let items = window.ADMIN_MOCK_SEED.subscriptions.map((s) => ({
      id: s.id,
      label: s.label,
    }));
    items = filterSearch(items, search, ["label"]);
    return { items };
  }

  async function mockGetBrands({ subscriptionId, search } = {}) {
    let items = window.ADMIN_MOCK_SEED.brands
      .filter((b) => !subscriptionId || b.subscriptionId === Number(subscriptionId))
      .map((b) => ({ id: b.id, label: b.label, subscriptionId: b.subscriptionId }));
    items = filterSearch(items, search, ["label"]);
    return { items };
  }

  async function mockGetClients({ subscriptionId, search, limit = 100 } = {}) {
    let items = window.ADMIN_MOCK_SEED.clients
      .filter((c) => !subscriptionId || c.subscriptionId === Number(subscriptionId))
      .map((c) => ({ id: c.id, label: c.label, subscriptionId: c.subscriptionId }));
    items = filterSearch(items, search, ["label"]);
    return { items: items.slice(0, limit) };
  }

  async function mockGetUsers({ search, limit = 50 } = {}) {
    let items = window.ADMIN_MOCK_SEED.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      subscriptionId: u.subscriptionId,
      blocked: u.blocked,
    }));
    items = filterSearch(items, search, ["name", "email"]);
    return { items: items.slice(0, limit) };
  }

  async function mockGetRoles({ subscriptionId } = {}) {
    let items = window.ADMIN_MOCK_SEED.roles
      .filter((r) => !subscriptionId || r.subscriptionId === Number(subscriptionId))
      .map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        subscriptionId: r.subscriptionId,
        defaultAdmin: r.defaultAdmin,
      }));
    return { items };
  }

  async function mockGetRolePermissions(roleId) {
    const state = readState();
    const allowed = state.rolePermissions[String(roleId)] || [];
    return { allowedIntents: allowed };
  }

  async function mockSaveRolePermissions(roleId, allowedIntents, actorUserId = 1001) {
    const state = readState();
    const before = state.rolePermissions[String(roleId)] || [];
    state.rolePermissions[String(roleId)] = allowedIntents;
    pushAudit(state, {
      actorUserId,
      action: "role.permissions.update",
      targetType: "role",
      targetId: String(roleId),
      summary: `Intent sayisi: ${allowedIntents.length}`,
      before,
      after: allowedIntents,
    });
    writeState(state);
    return { ok: true };
  }

  async function mockGetUserRoles(userId) {
    const state = readState();
    return { roleIds: state.userRoles[String(userId)] || [] };
  }

  async function mockSaveUserRoles(userId, roleIds, actorUserId = 1001) {
    const state = readState();
    const before = state.userRoles[String(userId)] || [];
    state.userRoles[String(userId)] = roleIds;
    pushAudit(state, {
      actorUserId,
      action: "user.roles.update",
      targetType: "user",
      targetId: String(userId),
      summary: `Rol sayisi: ${roleIds.length}`,
      before,
      after: roleIds,
    });
    writeState(state);
    return { ok: true };
  }

  async function mockGetUserPermissions(userId) {
    const state = readState();
    return {
      allowedIntents: state.userPermissions[String(userId)] || [],
    };
  }

  async function mockSaveUserPermissions(userId, allowedIntents, actorUserId = 1001) {
    const state = readState();
    const before = state.userPermissions[String(userId)] || [];
    state.userPermissions[String(userId)] = allowedIntents;
    pushAudit(state, {
      actorUserId,
      action: "user.permissions.update",
      targetType: "user",
      targetId: String(userId),
      summary: `Kullanici intent: ${allowedIntents.length} adet`,
      before: { allowedIntents: before },
      after: { allowedIntents },
    });
    writeState(state);
    return { ok: true };
  }

  async function mockGetUserScopes(userId) {
    const state = readState();
    const scopes = state.userScopes[String(userId)] || {
      allowedSubscriptionIds: null,
      allowedBrandIds: null,
      allowedClientIds: null,
      allowedCountryIds: null,
      allowedRegionIds: null,
      allowedCityIds: null,
      allowedDistrictIds: null,
    };
    return scopes;
  }

  async function mockGetUserDerivedScopes(userId) {
    const user = (window.ADMIN_MOCK_SEED?.users || []).find((u) => u.id === Number(userId));
    const subId = user?.subscriptionId || null;
    const subs = window.ADMIN_MOCK_SEED?.subscriptions || [];
    const company = subs.find((s) => s.id === subId);
    return {
      allowedSubscriptionIds: subId ? [subId] : null,
      allowedCountryIds: null,
      allowedTeamIds: null,
      allowedBrandIds: null,
      labels: {
        companies: company ? [{ id: company.id, label: company.label }] : [],
        countries: [],
        teams: [],
        brands: [],
      },
      source: "database",
    };
  }

  async function mockSaveUserScopes(userId, scopes, actorUserId = 1001) {
    const state = readState();
    const before = state.userScopes[String(userId)] || null;
    state.userScopes[String(userId)] = scopes;
    pushAudit(state, {
      actorUserId,
      action: "user.scopes.update",
      targetType: "user",
      targetId: String(userId),
      summary: "Scope güncellendi",
      before,
      after: scopes,
    });
    writeState(state);
    return { ok: true };
  }

  async function mockGetEffectivePermissions(userId) {
    const state = readState();
    const roleIds = state.userRoles[String(userId)] || [];
    const intentSet = new Set();
    let isSuperAdmin = false;

    roleIds.forEach((roleId) => {
      const perms = state.rolePermissions[String(roleId)] || [];
      if (perms.includes("*")) isSuperAdmin = true;
      perms.forEach((i) => intentSet.add(i));
    });

    const directIntents = state.userPermissions[String(userId)] || [];
    if (directIntents.includes("*")) isSuperAdmin = true;
    directIntents.forEach((i) => intentSet.add(i));

    const scopes = state.userScopes[String(userId)] || {
      allowedSubscriptionIds: null,
      allowedBrandIds: null,
      allowedClientIds: null,
    };

    return {
      userId: Number(userId),
      roleIds,
      isSuperAdmin,
      allowedIntents: isSuperAdmin ? ["*"] : [...intentSet].filter((i) => i !== "*"),
      directAllowedIntents: directIntents,
      allowedSubscriptionIds: scopes.allowedSubscriptionIds ?? null,
      allowedBrandIds: scopes.allowedBrandIds ?? null,
      allowedClientIds: scopes.allowedClientIds ?? null,
    };
  }

  async function mockGetAuditLogs(limit = 50) {
    const state = readState();
    return { items: state.auditLogs.slice(0, limit) };
  }

  /* ---------- REAL API (Kişi 2) ---------- */

  async function realGetCatalog() {
    return fetchJson(`${API_BASE}/catalog`);
  }

  async function realGetSubscriptions(search) {
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    return fetchJson(`${API_BASE}/reference/subscriptions${q}`);
  }

  async function realGetTeams(params = {}) {
    const qs = new URLSearchParams();
    if (params.subscriptionId) qs.set("subscriptionId", params.subscriptionId);
    if (params.search) qs.set("search", params.search);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/reference/teams${q}`);
  }

  async function realGetBrands(params = {}) {
    const qs = new URLSearchParams();
    if (params.subscriptionId) qs.set("subscriptionId", params.subscriptionId);
    if (params.search) qs.set("search", params.search);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/reference/brands${q}`);
  }

  async function realGetClients(params = {}) {
    const qs = new URLSearchParams();
    if (params.subscriptionId) qs.set("subscriptionId", params.subscriptionId);
    if (params.search) qs.set("search", params.search);
    if (params.limit) qs.set("limit", params.limit);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/reference/clients${q}`);
  }

  async function realGetCountries(params = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.limit) qs.set("limit", params.limit);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/reference/countries${q}`);
  }

  async function realGetRegions(params = {}) {
    const qs = new URLSearchParams();
    if (params.subscriptionId) qs.set("subscriptionId", params.subscriptionId);
    if (params.search) qs.set("search", params.search);
    if (params.limit) qs.set("limit", params.limit);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/reference/regions${q}`);
  }

  async function realGetCities(params = {}) {
    const qs = new URLSearchParams();
    if (params.subscriptionId) qs.set("subscriptionId", params.subscriptionId);
    if (params.search) qs.set("search", params.search);
    if (params.limit) qs.set("limit", params.limit);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/reference/cities${q}`);
  }

  async function realGetDistricts(params = {}) {
    const qs = new URLSearchParams();
    if (params.cityId) qs.set("cityId", params.cityId);
    if (params.cityIds) qs.set("cityIds", params.cityIds);
    if (params.all) qs.set("all", "true");
    if (params.search) qs.set("search", params.search);
    if (params.limit) qs.set("limit", params.limit);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/reference/districts${q}`);
  }

  async function realGetUsers(params = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.limit) qs.set("limit", params.limit);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/users${q}`);
  }

  async function realGetRoles(params = {}) {
    const qs = new URLSearchParams();
    if (params.subscriptionId) qs.set("subscriptionId", params.subscriptionId);
    const q = qs.toString() ? `?${qs}` : "";
    return fetchJson(`${API_BASE}/roles${q}`);
  }

  async function realGetRolePermissions(roleId) {
    return fetchJson(`${API_BASE}/roles/${roleId}/permissions`);
  }

  async function realSaveRolePermissions(roleId, allowedIntents) {
    return fetchJson(`${API_BASE}/roles/${roleId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedIntents }),
    });
  }

  async function realLogin(email, password) {
    const data = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    });
    setToken(data.token);
    return data;
  }

  async function realLogout() {
    const token = getToken();
    if (token) {
      try {
        await fetch("/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }).catch(() => {});
      } catch (_e) {
        // ignore
      }
    }
    clearToken();
  }

  async function realGetUserRoles(userId) {
    return fetchJson(`${API_BASE}/users/${userId}/roles`);
  }

  async function realSaveUserRoles(userId, roleIds) {
    return fetchJson(`${API_BASE}/users/${userId}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleIds }),
    });
  }

  async function realGetUserPermissions(userId) {
    return fetchJson(`${API_BASE}/users/${userId}/permissions`);
  }

  async function realSaveUserPermissions(userId, allowedIntents) {
    return fetchJson(`${API_BASE}/users/${userId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedIntents }),
    });
  }

  async function realGetUserScopes(userId) {
    return fetchJson(`${API_BASE}/users/${userId}/scopes`);
  }

  async function realGetUserDerivedScopes(userId) {
    return fetchJson(`${API_BASE}/users/${userId}/scopes/derived`);
  }

  async function realSaveUserScopes(userId, scopes) {
    return fetchJson(`${API_BASE}/users/${userId}/scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scopes),
    });
  }

  async function realGetUserHierarchy(userId) {
    return fetchJson(`${API_BASE}/users/${userId}/hierarchy`);
  }

  async function realGetEffectivePermissions(userId) {
    return fetchJson(`${API_BASE}/users/${userId}/effective-permissions`);
  }

  async function realGetAuditLogs(limit = 50) {
    return fetchJson(`${API_BASE}/audit-logs?limit=${limit}`);
  }

  function pick(mockFn, realFn) {
    return (...args) => (USE_MOCK ? mockFn(...args) : realFn(...args));
  }

  return {
    USE_MOCK,
    getToken,
    setToken,
    clearToken,
    login: pick(
      async () => ({ token: "mock", user: { name: "Mock Admin" } }),
      realLogin
    ),
    logout: pick(
      async () => {},
      realLogout
    ),
    getCatalog: pick(mockGetCatalog, realGetCatalog),
    getSubscriptions: pick(mockGetSubscriptions, realGetSubscriptions),
    getCountries: pick(async () => ({ items: [] }), realGetCountries),
    getRegions: pick(async () => ({ items: [] }), realGetRegions),
    getCities: pick(async () => ({ items: [] }), realGetCities),
    getDistricts: pick(async () => ({ items: [] }), realGetDistricts),
    getBrands: pick(mockGetBrands, realGetBrands),
    getTeams: pick(async () => ({ items: [] }), realGetTeams),
    getClients: pick(mockGetClients, realGetClients),
    getUsers: pick(mockGetUsers, realGetUsers),
    getRoles: pick(mockGetRoles, realGetRoles),
    getRolePermissions: pick(mockGetRolePermissions, realGetRolePermissions),
    saveRolePermissions: pick(mockSaveRolePermissions, realSaveRolePermissions),
    getUserRoles: pick(mockGetUserRoles, realGetUserRoles),
    saveUserRoles: pick(mockSaveUserRoles, realSaveUserRoles),
    getUserPermissions: pick(mockGetUserPermissions, realGetUserPermissions),
    saveUserPermissions: pick(mockSaveUserPermissions, realSaveUserPermissions),
    getUserScopes: pick(mockGetUserScopes, realGetUserScopes),
    getUserDerivedScopes: pick(mockGetUserDerivedScopes, realGetUserDerivedScopes),
    saveUserScopes: pick(mockSaveUserScopes, realSaveUserScopes),
    getUserHierarchy: pick(async (userId) => mockGetEffectivePermissions(userId), realGetUserHierarchy),
    getEffectivePermissions: pick(mockGetEffectivePermissions, realGetEffectivePermissions),
    getAuditLogs: pick(mockGetAuditLogs, realGetAuditLogs),
  };
})();
