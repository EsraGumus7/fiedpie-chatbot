const tests = [
  { intent: "userTotalCount", question: "toplam kac kullanici var" },
  { intent: "userStatusSummary", question: "aktif kullanici sayisi kac" },
  { intent: "userAdminSummary", question: "admin kullanici sayisi kac" },
  { intent: "usersByRole", question: "hangi rolde kac kisi var" },
  { intent: "usersByTeam", question: "takimlara gore kullanici dagilimi" },
  { intent: "usersByBrand", question: "markalara gore kullanici dagilimi" },
  { intent: "usersByClient", question: "musterilere gore kullanici dagilimi" },
  { intent: "userRecentLogins", question: "en son kimler giris yapmis" },
  { intent: "userLoginSuccessSummary", question: "basarili ve basarisiz girisler" },
  { intent: "userDeviceSummary", question: "kullanici cihaz ozeti" },
  { intent: "userSavedViewSummary", question: "kayitli gorunum ozeti" },
  { intent: "userStepSummary", question: "kullanici adim ozeti" },
  { intent: "userVisitSummary", question: "kullanici ziyaret ozeti" },
];

async function run() {
  const base = process.env.API_BASE || "http://localhost:3000";
  const only = process.env.ONLY_INTENT
    ? tests.filter((t) => t.intent === process.env.ONLY_INTENT)
    : tests;

  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.TEST_EMAIL || "mehmetkordon09@gmail.com",
      password: process.env.TEST_PASSWORD || "1463",
    }),
  });
  const login = await loginRes.json();
  if (!login.token) {
    console.log("LOGIN FAIL", login);
    process.exit(1);
  }

  const token = login.token;
  console.log(`Logged in as user ${login.user?.id} (${login.user?.name})`);

  const results = [];

  for (const t of only) {
    const res = await fetch(`${base}/api/chat/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question: t.question }),
    });
    const data = await res.json();

    const intentMatch = data.intent === t.intent;
    const hasError = !!data.error;
    const denied = data.scopePlan?.mode === "denied";
    const clarify = data.needsClarification || data.scopePlan?.mode === "clarify";
    const ok = res.ok && intentMatch && !hasError && !denied && !clarify;

    const row = {
      status: ok ? "OK" : "FAIL",
      expected: t.intent,
      resolved: data.intent,
      http: res.status,
      question: t.question,
      error: data.error || null,
      clarify: clarify ? data.message || data.answer : null,
      denied: denied ? data.answer : null,
      rowCount: Array.isArray(data.rows) ? data.rows.length : 0,
      answer: (data.answer || "").slice(0, 160),
    };
    results.push(row);

    console.log("---");
    console.log(`${row.status} ${t.intent}`);
    console.log(`  Q: ${t.question}`);
    console.log(`  Resolved: ${data.intent} (expected ${t.intent})`);
    if (data.error) console.log(`  Error: ${data.error}`);
    if (clarify) console.log(`  Clarify: ${row.clarify}`);
    if (denied) console.log(`  Denied: ${row.denied}`);
    console.log(`  Rows: ${row.rowCount}`);
    console.log(`  Answer: ${row.answer}`);
    if (!intentMatch && data.candidates?.length) {
      console.log(
        `  Candidates: ${data.candidates
          .slice(0, 5)
          .map((c) => `${c.intent}:${c.score}`)
          .join(", ")}`
      );
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log("\n=== SUMMARY ===");
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log("Failed:", failed.map((f) => `${f.expected} -> ${f.resolved || "?"}`).join(", "));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
