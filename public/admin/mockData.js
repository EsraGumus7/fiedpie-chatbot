/** Seed veri — docs/admin-permission-db-haritasi.md ile uyumlu (WorkForce_Prod şeması) */
window.ADMIN_MOCK_SEED = {
  subscriptions: [
    { id: 1, label: "FieldPie TR", blocked: false },
    { id: 2, label: "FieldPie EU", blocked: false },
  ],
  brands: [
    { id: 2, label: "Marka A", subscriptionId: 1 },
    { id: 7, label: "Marka B", subscriptionId: 1 },
    { id: 9, label: "Marka C", subscriptionId: 2 },
  ],
  clients: [
    { id: 1001, label: "Migros Kadıköy (1001)", subscriptionId: 1, code: "MG-KDK" },
    { id: 1002, label: "Carrefour Ataşehir (1002)", subscriptionId: 1, code: "CF-ATA" },
    { id: 1003, label: "BIM Üsküdar (1003)", subscriptionId: 1, code: "BIM-USK" },
    { id: 1004, label: "EU Client Demo (1004)", subscriptionId: 2, code: "EU-001" },
  ],
  users: [
    { id: 1001, name: "Test Admin", email: "admin@test.local", subscriptionId: 1, blocked: false },
    { id: 1002, name: "Test Manager", email: "manager@test.local", subscriptionId: 1, blocked: false },
    { id: 1003, name: "Test Saha 1", email: "saha1@test.local", subscriptionId: 1, blocked: false },
    { id: 1004, name: "Test Viewer", email: "viewer@test.local", subscriptionId: 2, blocked: false },
  ],
  roles: [
    { id: 1, name: "Sistem Yöneticisi", code: "admin", subscriptionId: 1, defaultAdmin: true },
    { id: 2, name: "Bölge Yöneticisi", code: "manager", subscriptionId: 1, defaultAdmin: false },
    { id: 3, name: "Saha Personeli", code: "field_user", subscriptionId: 1, defaultAdmin: false },
    { id: 4, name: "Salt Okunur", code: "viewer", subscriptionId: 2, defaultAdmin: false },
  ],
  userRoles: {
    1001: [1],
    1002: [2],
    1003: [3],
    1004: [4],
  },
  userPermissions: {
    1004: ["visitCountRealized"],
  },
  rolePermissions: {
    1: ["*"],
    2: [
      "visitCountRealized",
      "visitTrend",
      "visitsByState",
      "clientCountActive",
      "totalInvoices",
      "totalInvoiceAmount",
    ],
    3: ["visitCountRealized", "visitTrend", "avgVisitDuration", "userVisitSummary"],
    4: ["visitCountRealized", "clientCountTotal"],
  },
  userScopes: {
    1002: { allowedSubscriptionIds: [1], allowedBrandIds: null, allowedClientIds: null },
    1003: { allowedSubscriptionIds: [1], allowedBrandIds: [2], allowedClientIds: [1001, 1002] },
  },
  auditLogs: [
    {
      id: 1,
      createdAt: "2026-05-28T14:30:00Z",
      actorUserId: 1001,
      action: "role.permissions.update",
      targetType: "role",
      targetId: "3",
      summary: "Saha personeli intent listesi güncellendi",
    },
  ],
  fallbackIntents: [
    { intent: "visitCountRealized", metric_id: "visit_count_realized", domain: "visit", description_tr: "Gerçekleşen ziyaret sayısı" },
    { intent: "visitTrend", metric_id: "visit_daily_trend", domain: "visit", description_tr: "Günlük ziyaret trendi" },
    { intent: "clientCountActive", metric_id: "client_count_active", domain: "client", description_tr: "Aktif müşteri sayısı" },
    { intent: "totalInvoices", metric_id: "total_invoices", domain: "sales", description_tr: "Toplam fatura sayısı" },
    { intent: "userVisitSummary", metric_id: "user_visit_summary", domain: "users", description_tr: "Kullanıcı bazlı ziyaret özeti" },
  ],
};
