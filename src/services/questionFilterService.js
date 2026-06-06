const MIN_TEAM_TOKEN_LENGTH = 4;

function normalizeScopeQuestion(question = "") {
  return String(question || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "c");
}

function tokenizeTeamName(teamName = "") {
  return normalizeScopeQuestion(teamName)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TEAM_TOKEN_LENGTH);
}

function detectTeamFromQuestion(question = "", managedTeams = []) {
  if (!managedTeams.length) {
    return null;
  }

  const normalizedQuestion = normalizeScopeQuestion(question);
  const fullNameMatches = [];
  const tokenMatches = [];

  for (const team of managedTeams) {
    const normalizedTeamName = normalizeScopeQuestion(team.teamName || "");
    if (!normalizedTeamName) {
      continue;
    }

    if (normalizedQuestion.includes(normalizedTeamName)) {
      fullNameMatches.push(team);
      continue;
    }

    const tokens = tokenizeTeamName(team.teamName);
    const tokenHits = tokens.filter((token) => normalizedQuestion.includes(token));
    if (tokenHits.length >= 1) {
      tokenMatches.push({ ...team, _tokenHits: tokenHits.length });
    }
  }

  if (fullNameMatches.length === 1) {
    return {
      teamId: fullNameMatches[0].teamId,
      teamName: fullNameMatches[0].teamName,
    };
  }

  if (fullNameMatches.length > 1) {
    return {
      ambiguous: fullNameMatches.map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
      })),
    };
  }

  if (!tokenMatches.length) {
    return null;
  }

  if (tokenMatches.length === 1) {
    return {
      teamId: tokenMatches[0].teamId,
      teamName: tokenMatches[0].teamName,
    };
  }

  const sorted = [...tokenMatches].sort(
    (a, b) => (b._tokenHits ?? 1) - (a._tokenHits ?? 1)
  );
  const bestScore = sorted[0]._tokenHits ?? 1;
  const tied = sorted.filter((item) => (item._tokenHits ?? 1) === bestScore);

  if (tied.length === 1) {
    return {
      teamId: tied[0].teamId,
      teamName: tied[0].teamName,
    };
  }

  return {
    ambiguous: tied.map((team) => ({
      teamId: team.teamId,
      teamName: team.teamName,
    })),
  };
}

function detectVisitRealizedFromQuestion(question = "", intent = "") {
  const normalizedIntent = String(intent).trim();
  if (
    normalizedIntent === "visitsByCompletionStatus" ||
    normalizedIntent === "visitsByState"
  ) {
    return null;
  }

  const normalized = normalizeScopeQuestion(question);

  const wantsPending =
    /\b(bekleyen|bekleyenler|planlanan|planli|planlanmis|yapilmamis|tamamlanmamis|pending|unrealized)\b/.test(
      normalized
    );
  const wantsCompleted =
    /\b(tamamlanan|tamamlanmis|gerceklesen|gerceklestirilen|realized|completed|yapilan|yapilmis)\b/.test(
      normalized
    );

  if (wantsPending && !wantsCompleted) {
    return 0;
  }
  if (wantsCompleted && !wantsPending) {
    return 1;
  }

  if (String(intent).trim() === "visitCountRealized") {
    return 1;
  }

  return null;
}

function enrichQueryParams(question = "", intent = "", params = {}) {
  const visitRealized = detectVisitRealizedFromQuestion(question, intent);
  if (visitRealized === null || visitRealized === undefined) {
    return params;
  }

  return {
    ...params,
    visitRealized,
  };
}

function buildTeamClarificationAnswer(teamMatch = {}) {
  const options = (teamMatch.ambiguous || [])
    .map((team) => `- ${team.teamName}`)
    .join("\n");

  return `Birden fazla takim eslesti. Hangi takimi kastettiniz?\n${options}`;
}

function buildOutOfScopeTeamAnswer(teamMatch = {}) {
  const teamName = teamMatch.teamName || "Bu takim";
  return `"${teamName}" yonetim kapsaminizda degil. Yonetilen takimlariniz icin takim adiyla sorabilirsiniz; sirket geneli icin "sirket ..." kullanin.`;
}

function buildRangeLabel(params = {}) {
  if (params.startDate && params.endDate && params.startDate === params.endDate) {
    return params.startDate;
  }
  if (params.startDate || params.endDate) {
    return `${params.startDate || "-"} - ${params.endDate || "-"}`;
  }
  return "Tum donem";
}

function buildVisitStatusLabel(params = {}) {
  if (params.visitRealized === 0) {
    return "bekleyen ziyaret";
  }
  if (params.visitRealized === 1) {
    return "gerceklesen ziyaret";
  }
  return "ziyaret";
}

function isVisitStatusDistributionQuestion(question = "") {
  const normalized = normalizeScopeQuestion(question);
  const hasVisit = /\b(ziyaret|visit|saha)\b/.test(normalized);
  const statusPattern =
    /\b(bekleyen|bekleyenler|tamamlanan|tamamlanmis|gerceklesen|gerceklestirilen|planlanan|planli|planlanmis|durum|durumu|status)\b/;
  const countOnlyPattern =
    /\b(ziyaret sayisi|ziyaret sayısı|toplam ziyaret|kac ziyaret|kaç ziyaret|visit sayisi)\b/;

  if (countOnlyPattern.test(normalized) && !statusPattern.test(normalized)) {
    return false;
  }

  if (/\bziyaret durum/.test(normalized)) {
    return true;
  }

  return hasVisit && statusPattern.test(normalized);
}

function resolveVisitIntentOverride(question = "", intent = "") {
  if (!isVisitStatusDistributionQuestion(question)) {
    return null;
  }

  const normalizedIntent = String(intent || "").trim();
  if (
    normalizedIntent === "visitsByCompletionStatus" ||
    normalizedIntent === "visitsByState"
  ) {
    return normalizedIntent;
  }

  return "visitsByCompletionStatus";
}

function parseQuestionFilters(question = "", intent = "", filters = {}) {
  return enrichQueryParams(question, intent, filters);
}

module.exports = {
  normalizeScopeQuestion,
  detectTeamFromQuestion,
  detectVisitRealizedFromQuestion,
  isVisitStatusDistributionQuestion,
  resolveVisitIntentOverride,
  enrichQueryParams,
  parseQuestionFilters,
  buildTeamClarificationAnswer,
  buildOutOfScopeTeamAnswer,
  buildRangeLabel,
  buildVisitStatusLabel,
};
