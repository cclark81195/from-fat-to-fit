// From Fat to Fit — front end
// All privacy enforcement happens in Postgres (see schema.sql). This file
// just calls Supabase auth + the RPC functions and renders the result.

const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

let currentChallengeId = localStorage.getItem("wlc_challenge_id") || null;

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
  const { error } = await supabase.auth.signInWithOtp({
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
});

$("auth-resend").addEventListener("click", () => {
  show($("auth-email-step"));
  hide($("auth-sent-step"));
});

$("signout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
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

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    renderSignedIn(session);
  } else {
    renderSignedOut();
  }
});

async function init() {
  const { data } = await supabase.auth.getSession();
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
  const { data, error } = await supabase
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

  const { data, error } = await supabase.rpc("join_challenge", {
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

  const { data, error } = await supabase.rpc("create_challenge", { p_name: name });
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

  const { data: challenge } = await supabase
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
}

async function loadMyStats() {
  const { data, error } = await supabase.rpc("get_my_stats", {
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

  const { error } = await supabase.rpc("set_goal", {
    p_challenge_id: currentChallengeId,
    p_goal_weight: goal,
  });

  if (error) {
    $("goal-error").textContent = error.message;
    show($("goal-error"));
    return;
  }

  await loadMyStats();
});

async function loadLeaderboard() {
  const { data, error } = await supabase.rpc("get_leaderboard", {
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

  const { data: existing } = await supabase
    .from("weigh_ins")
    .select("id")
    .eq("challenge_id", currentChallengeId)
    .eq("recorded_on", date)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabase.from("weigh_ins").update({ weight }).eq("id", existing.id));
  } else {
    ({ error } = await supabase.from("weigh_ins").insert({
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
  selectTab("stats");
});

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
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
