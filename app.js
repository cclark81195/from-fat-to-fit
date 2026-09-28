// From Fat to Fit — front end
// All privacy enforcement happens in Postgres (see schema.sql). This file
// just calls Supabase auth + the RPC functions and renders the result.

const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

let currentChallengeId = localStorage.getItem("wlc_challenge_id") || null;
let currentGoalWeight = null;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

$("send-link-btn").addEventListener("click", async () => {
  const email = $("email").value.trim();
  hide($("auth-error"));
  if (!email) {
    $("auth-error").textContent = "Enter your email address.";
    show($("auth-error"));
    return;
  }

  const btn = $("send-link-btn");
  const originalLabel = btn.textContent;
  btn.textContent = "Sending…";
  btn.disabled = true;

  try {
    const { error } = await db.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    });
    if (error) {
      $("auth-error").textContent = error.message;
      show($("auth-error"));
      return;
    }
    hide($("auth-email-step"));
    show($("auth-sent-step"));
  } catch (err) {
    // A network-level failure (blocked request, offline, etc.) throws
    // instead of returning {error} — without this catch, that used to
    // fail completely silently. Now it's at least visible.
    $("auth-error").textContent =
      "Couldn't reach the server (" + (err && err.message ? err.message : "network error") +
      "). Check your connection, or try disabling any ad blocker / VPN / private browsing mode and try again.";
    show($("auth-error"));
  } finally {
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});

$("auth-resend").addEventListener("click", () => {
  show($("auth-email-step"));
  hide($("auth-sent-step"));
});

$("signout-btn").addEventListener("click", async () => {
  await db.auth.signOut();
  localStorage.removeItem("wlc_challenge_id");
  currentChallengeId = null;
  renderSignedOut();
});

$("switch-challenge").addEventListener("click", () => {
  currentChallengeId = null;
  localStorage.removeItem("wlc_challenge_id");
  hide($("main-view"));
  show($("onboard-view"));
  loadMyChallenges();
});

db.auth.onAuthStateChange((_event, session) => {
  if (session) {
    renderSignedIn(session);
  } else {
    renderSignedOut();
  }
});

async function init() {
  const { data } = await db.auth.getSession();
  if (data.session) {
    renderSignedIn(data.session);
  } else {
    renderSignedOut();
  }
}

function renderSignedOut() {
  hide($("app-view"));
  show($("auth-view"));
  show($("auth-email-step"));
  hide($("auth-sent-step"));
}

async function renderSignedIn(session) {
  hide($("auth-view"));
  show($("app-view"));
  $("who").textContent = session.user.email;

  if (currentChallengeId) {
    openChallenge(currentChallengeId);
  } else {
    hide($("main-view"));
    show($("onboard-view"));
    loadMyChallenges();
  }
}

// ---------------------------------------------------------------------------
// Onboarding: join or create a challenge
// ---------------------------------------------------------------------------

async function loadMyChallenges() {
  // Show any challenges this user has already joined, as quick-select buttons.
  const { data, error } = await db
    .from("participants")
    .select("challenge_id, challenges(name, join_code)")
    .order("joined_at", { ascending: false });

  const existing = $("existing-challenges");
  if (existing) existing.remove();

  if (error || !data || data.length === 0) return;

  const container = document.createElement("div");
  container.className = "card";
  container.id = "existing-challenges";
  container.innerHTML = `<h2>Your challenges</h2>`;
  data.forEach((row) => {
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.style.marginBottom = "8px";
    btn.textContent = `${row.challenges.name} (${row.challenges.join_code})`;
    btn.addEventListener("click", () => openChallenge(row.challenge_id));
    container.appendChild(btn);
  });
  $("onboard-view").prepend(container);
}

$("join-btn").addEventListener("click", async () => {
  const code = $("join-code").value.trim().toUpperCase();
  const name = $("join-name").value.trim();
  const weight = parseFloat($("join-weight").value);
  hide($("join-error"));

  if (!code || !name || !weight || weight <= 0) {
    $("join-error").textContent = "Fill in the join code, your name, and a valid starting weight.";
    show($("join-error"));
    return;
  }

  const { data, error } = await db.rpc("join_challenge", {
    p_join_code: code,
    p_display_name: name,
    p_starting_weight: weight,
  });

  if (error) {
    $("join-error").textContent = error.message;
    show($("join-error"));
    return;
  }

  openChallenge(data);
});

$("create-btn").addEventListener("click", async () => {
  const name = $("new-challenge-name").value.trim();
  if (!name) return;

  const { data, error } = await db.rpc("create_challenge", { p_name: name });
  if (error) {
    alert(error.message);
    return;
  }
  const row = data[0];
  $("new-code").textContent = row.join_code;
  show($("create-result"));
  // Pre-fill the join code below so they can join their own challenge right away.
  $("join-code").value = row.join_code;
});

// ---------------------------------------------------------------------------
// Main challenge view
// ---------------------------------------------------------------------------

async function openChallenge(challengeId) {
  currentChallengeId = challengeId;
  localStorage.setItem("wlc_challenge_id", challengeId);

  hide($("onboard-view"));
  show($("main-view"));

  const { data: challenge } = await db
    .from("challenges")
    .select("name, join_code")
    .eq("id", challengeId)
    .single();

  if (challenge) {
    $("challenge-title").textContent = challenge.name;
    $("challenge-code").textContent = challenge.join_code;
  }

  $("weigh-date").value = new Date().toISOString().slice(0, 10);
  $("daily-quote").textContent = `“${window.getDailyQuote()}”`;

  await loadMyStats();
  await loadLeaderboard();
  await loadHistory();
}

async function loadMyStats() {
  const { data, error } = await db.rpc("get_my_stats", {
    p_challenge_id: currentChallengeId,
  });
  if (error || !data || data.length === 0) return;

  const row = data[0];
  $("stat-pct").textContent = `${row.percent_lost >= 0 ? "-" : "+"}${Math.abs(row.percent_lost)}%`;
  $("stat-lbs").textContent = `${row.lbs_lost >= 0 ? "-" : "+"}${Math.abs(row.lbs_lost)}`;
  $("stat-meta").textContent = row.last_weigh_in
    ? `Last weigh-in: ${row.last_weigh_in} · ${row.weigh_in_count} logged`
    : "No weigh-ins logged yet — your starting weight is currently your current weight.";
  $("greeting").textContent = row.display_name ? `Hey ${row.display_name}, here's where you stand today.` : "";

  // Goal weight + progress toward it — private to this user; comes back
  // from get_my_stats only for the signed-in caller (see schema.sql).
  $("goal-weight").value = row.goal_weight ?? "";
  if (row.goal_weight != null && row.goal_percent != null) {
    show($("goal-progress"));
    $("goal-progress-fill").style.width = `${row.goal_percent}%`;
    $("goal-progress-label").textContent = `${row.goal_percent}% of the way to your goal`;
    $("goal-remaining-label").textContent =
      row.lbs_to_goal > 0 ? `${row.lbs_to_goal} lbs to go` : "Goal reached! 🎉";
  } else {
    hide($("goal-progress"));
  }
  currentGoalWeight = row.goal_weight ?? null;
}

$("save-goal-btn").addEventListener("click", async () => {
  const raw = $("goal-weight").value.trim();
  const goal = raw === "" ? null : parseFloat(raw);
  hide($("goal-error"));

  if (raw !== "" && (!goal || goal <= 0)) {
    $("goal-error").textContent = "Enter a positive goal weight, or leave it blank to clear your goal.";
    show($("goal-error"));
    return;
  }

  const { error } = await db.rpc("set_goal", {
    p_challenge_id: currentChallengeId,
    p_goal_weight: goal,
  });

  if (error) {
    $("goal-error").textContent = error.message;
    show($("goal-error"));
    return;
  }

  await loadMyStats();
  await loadHistory();
});

async function loadLeaderboard() {
  const { data, error } = await db.rpc("get_leaderboard", {
    p_challenge_id: currentChallengeId,
  });
  const list = $("leaderboard-list");
  list.innerHTML = "";
  if (error) {
    list.innerHTML = `<p class="error">${error.message}</p>`;
    hide($("first-quote-card"));
    hide($("last-quote-card"));
    return;
  }

  const rankClass = (rank) => (rank === 1 ? " rank-1" : "");
  const rankIconClass = (rank) => (rank === 1 ? " gold" : rank === 2 ? " silver" : rank === 3 ? " bronze" : "");

  data.forEach((row) => {
    const div = document.createElement("div");
    div.className = "lb-row" + (row.is_you ? " you" : rankClass(row.rank));
    const medal = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank;
    div.innerHTML = `
      <span class="lb-rank${rankIconClass(row.rank)}">${medal}</span>
      <span class="lb-name">${escapeHtml(row.display_name)}${row.is_you ? " (you)" : ""}</span>
      <span class="lb-pct">${row.percent_lost >= 0 ? "-" : "+"}${Math.abs(row.percent_lost)}%</span>
    `;
    list.appendChild(div);
  });

  // First-place shoutout + a nudge for whoever's currently last. Skip the
  // "last place" card entirely when there's only one person, so a solo
  // participant doesn't get a discouraging message aimed at themselves.
  if (data.length > 0) {
    const first = data[0];
    const last = data[data.length - 1];

    $("first-quote-text").textContent = window.getFirstPlaceQuote(first.display_name);
    show($("first-quote-card"));

    if (data.length > 1) {
      $("last-quote-text").textContent = window.getLastPlaceQuote(last.display_name);
      show($("last-quote-card"));
    } else {
      hide($("last-quote-card"));
    }
  } else {
    hide($("first-quote-card"));
    hide($("last-quote-card"));
  }
}

$("log-btn").addEventListener("click", async () => {
  const weight = parseFloat($("new-weight").value);
  const date = $("weigh-date").value;
  hide($("log-error"));

  if (!weight || weight <= 0 || !date) {
    $("log-error").textContent = "Enter a valid weight and date.";
    show($("log-error"));
    return;
  }

  const { data: existing } = await db
    .from("weigh_ins")
    .select("id")
    .eq("challenge_id", currentChallengeId)
    .eq("recorded_on", date)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await db.from("weigh_ins").update({ weight }).eq("id", existing.id));
  } else {
    ({ error } = await db.from("weigh_ins").insert({
      challenge_id: currentChallengeId,
      weight,
      recorded_on: date,
    }));
  }

  if (error) {
    $("log-error").textContent = error.message;
    show($("log-error"));
    return;
  }

  $("new-weight").value = "";
  await loadMyStats();
  await loadLeaderboard();
  await loadHistory();
  selectTab("stats");
});

// ---------------------------------------------------------------------------
// History: view, edit, delete past weigh-ins + trend chart
// ---------------------------------------------------------------------------

let historyRows = []; // cached ascending-by-date, used by both the list and the chart

async function loadHistory() {
  const { data, error } = await db
    .from("weigh_ins")
    .select("id, weight, recorded_on")
    .eq("challenge_id", currentChallengeId)
    .order("recorded_on", { ascending: true });

  if (error) {
    $("history-list").innerHTML = `<p class="error">${error.message}</p>`;
    return;
  }

  historyRows = data || [];
  renderHistoryList();
  renderTrendChart();
}

function renderHistoryList() {
  const list = $("history-list");
  list.innerHTML = "";

  if (historyRows.length === 0) {
    show($("history-empty"));
    return;
  }
  hide($("history-empty"));

  // Most recent first for the list (the chart below uses ascending order).
  [...historyRows].reverse().forEach((entry) => {
    const row = document.createElement("div");
    row.className = "hist-row";

    const dateSpan = document.createElement("span");
    dateSpan.className = "hist-date";
    dateSpan.textContent = entry.recorded_on;

    const weightSpan = document.createElement("span");
    weightSpan.className = "hist-weight";
    weightSpan.textContent = `${entry.weight} lbs`;

    const actions = document.createElement("span");
    actions.className = "hist-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "hist-btn";
    editBtn.title = "Edit";
    editBtn.textContent = "✏️";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "hist-btn danger";
    deleteBtn.title = "Delete";
    deleteBtn.textContent = "🗑️";

    editBtn.addEventListener("click", () => startEditRow(row, entry, weightSpan, actions));
    deleteBtn.addEventListener("click", () => deleteRow(entry));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(dateSpan);
    row.appendChild(weightSpan);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function startEditRow(row, entry, weightSpan, actions) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.1";
  input.className = "hist-edit-input";
  input.value = entry.weight;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "hist-btn";
  saveBtn.title = "Save";
  saveBtn.textContent = "✅";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "hist-btn";
  cancelBtn.title = "Cancel";
  cancelBtn.textContent = "✖️";

  saveBtn.addEventListener("click", async () => {
    const newWeight = parseFloat(input.value);
    if (!newWeight || newWeight <= 0) return;
    const { error } = await db.from("weigh_ins").update({ weight: newWeight }).eq("id", entry.id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadMyStats();
    await loadLeaderboard();
    await loadHistory();
  });

  cancelBtn.addEventListener("click", () => renderHistoryList());

  weightSpan.replaceWith(input);
  actions.innerHTML = "";
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
}

async function deleteRow(entry) {
  if (!confirm(`Delete the ${entry.weight} lbs entry from ${entry.recorded_on}?`)) return;
  const { error } = await db.from("weigh_ins").delete().eq("id", entry.id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadMyStats();
  await loadLeaderboard();
  await loadHistory();
}

// Parses a "YYYY-MM-DD" date as a LOCAL midnight (not UTC), so it never
// shifts a day off in a negative-UTC-offset timezone the way `new
// Date("YYYY-MM-DD")` can.
function parseDateLocal(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function renderTrendChart() {
  const wrap = $("trend-chart-wrap");
  if (historyRows.length < 2) {
    hide(wrap);
    show($("trend-empty"));
    return;
  }
  hide($("trend-empty"));
  show(wrap);

  const W = 320, H = 170;
  const padL = 38, padR = 14, padT = 14, padB = 26;

  const points = historyRows.map((r) => ({
    t: parseDateLocal(r.recorded_on).getTime(),
    w: r.weight,
    date: r.recorded_on,
  }));

  const weights = points.map((p) => p.w);
  if (currentGoalWeight != null) weights.push(currentGoalWeight);
  let minW = Math.min(...weights);
  let maxW = Math.max(...weights);
  if (minW === maxW) { minW -= 1; maxW += 1; } // avoid a zero-height range
  const padRange = (maxW - minW) * 0.1 || 1;
  minW -= padRange;
  maxW += padRange;

  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const spanT = maxT - minT || 1;

  const x = (t) => padL + ((t - minT) / spanT) * (W - padL - padR);
  const y = (w) => padT + (1 - (w - minW) / (maxW - minW)) * (H - padT - padB);

  const linePoints = points.map((p) => `${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(" ");
  const areaPoints = `${x(points[0].t).toFixed(1)},${(H - padB).toFixed(1)} ${linePoints} ${x(
    points[points.length - 1].t
  ).toFixed(1)},${(H - padB).toFixed(1)}`;

  const circles = points
    .map(
      (p) =>
        `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="3.5" fill="#059669" stroke="#fff" stroke-width="1.5"><title>${
          p.date
        }: ${p.w} lbs</title></circle>`
    )
    .join("");

  const goalLine =
    currentGoalWeight != null
      ? `<line x1="${padL}" y1="${y(currentGoalWeight).toFixed(1)}" x2="${W - padR}" y2="${y(
          currentGoalWeight
        ).toFixed(1)}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="4 3" />
         <text x="${W - padR}" y="${y(currentGoalWeight).toFixed(1) - 4}" text-anchor="end" font-size="9" fill="#ea580c" font-family="Inter, sans-serif">Goal</text>`
      : "";

  const firstLabel = parseDateLocal(points[0].date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const lastLabel = parseDateLocal(points[points.length - 1].date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weight trend chart">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <text x="${padL}" y="${padT}" font-size="9" fill="#66756e" font-family="Inter, sans-serif">${maxW.toFixed(0)} lbs</text>
      <text x="${padL}" y="${H - padB}" font-size="9" fill="#66756e" font-family="Inter, sans-serif">${minW.toFixed(0)} lbs</text>
      ${goalLine}
      <polygon points="${areaPoints}" fill="url(#trendFill)" />
      <polyline points="${linePoints}" fill="none" stroke="#059669" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${circles}
      <text x="${padL}" y="${H - 6}" font-size="9" fill="#66756e" font-family="Inter, sans-serif">${firstLabel}</text>
      <text x="${W - padR}" y="${H - 6}" text-anchor="end" font-size="9" fill="#66756e" font-family="Inter, sans-serif">${lastLabel}</text>
    </svg>
  `;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
});

function selectTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  hide($("panel-stats"));
  hide($("panel-log"));
  hide($("panel-board"));
  show($("panel-" + name));
  if (name === "board") loadLeaderboard();
  if (name === "stats") loadMyStats();
  if (name === "log") loadHistory();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
