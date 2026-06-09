const tests = [
  { intent: "visitCountRealized", question: "toplam ziyaret sayisi" },
  { intent: "avgVisitDuration", question: "ortalama ziyaret suresi kac" },
  { intent: "visitsByCompletionStatus", question: "tamamlanan ve bekleyen ziyaret" },
  { intent: "visitsByState", question: "ziyaretler duruma gore nasil dagiliyor" },
  { intent: "visitsByType", question: "ziyaret tiplerine gore dagilim" },
  { intent: "visitTrend", question: "ziyaret trendi nasil" },
  { intent: "dynamicTopFields", question: "en cok doldurulan alanlar hangileri" },
  { intent: "dynamicFieldSummary", question: "raf alani kac kayitta dolu" },
];

async function run() {
  const base = process.env.API_BASE || "http://localhost:3000";
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

  for (const t of tests) {
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
      answer: (data.answer || "").slice(0, 120),
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
          .slice(0, 3)
          .map((c) => `${c.intent}:${c.score}`)
          .join(", ")}`
      );
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log("\n=== SUMMARY ===");
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log("Failed:", failed.map((f) => f.expected).join(", "));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
