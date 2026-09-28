# From Fat to Fit 🔥

A polished web app for tracking a group weight-loss challenge. Everyone can
see a leaderboard ranked by **percent of starting weight lost** — nobody,
including the person running the challenge, can see anyone else's actual
weight or pounds lost. You only ever see your own full numbers.

It also includes:
- A **daily motivational quote** on the home screen — deterministic by
  calendar date, so it's the same for everyone and changes automatically at
  midnight, with no server job needed (`quotes.js`).
- On the leaderboard, a **shoutout for whoever's currently #1** and an
  **encouraging nudge for whoever's currently last** — both name the person
  by their display name, and the "last place" message is deliberately framed
  as supportive rather than shaming (it's a family challenge, not a roast).
- A **personal goal weight** each person can set (or clear) for themselves,
  with a private progress bar toward it. Exactly as private as starting
  weight — nobody else can read it, and it never factors into the
  leaderboard, which is driven only by percent of starting weight lost.
- **Weigh-in history** on the Log tab — every past entry, editable or
  deletable inline, plus a **trend chart** (a dependency-free inline SVG
  line chart) showing weight over time with a dashed line at your goal
  weight once you've set one.

## How the privacy works (read this first)

This isn't "hide it in the UI" — the database itself enforces it:

- Your starting weight and every weigh-in you log are stored in tables with
  **row-level security**: your login can only ever read or write rows where
  `user_id` is you. Even a bug in the front-end JavaScript can't leak someone
  else's weight, because the database would refuse the query.
- The leaderboard is produced by one database function, `get_leaderboard`,
  which is allowed to look across everyone's data internally but only
  **returns** name + percent lost + rank. There's no column for weight or
  pounds lost in what it sends back.
- Your own stats come from `get_my_stats`, which only ever looks at your own
  rows.

See the comments at the top of `schema.sql` for the full explanation.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), create a free account and a
   new project.
2. In the project, open **SQL Editor**, paste in the entire contents of
   `schema.sql`, and run it. This creates the tables, the security policies,
   and the functions.
3. Go to **Authentication → Providers** and make sure **Email** is enabled.
   The app uses passwordless "magic link" sign-in, so no extra setup is
   needed — Supabase's default email sending works fine for a family-sized
   group. (If you want a nicer sending domain, you can configure SMTP under
   **Authentication → Emails**, but it's optional.)
4. Go to **Authentication → URL Configuration** and add the URL you'll be
   deploying to (e.g. `https://your-app.vercel.app`) to **Redirect URLs** —
   this is what lets the magic-link email bring people back to the app.
5. Go to **Project Settings → API** and copy the **Project URL** and the
   **anon public** key.

## 2. Configure the app

Open `config.js` and fill in the two values from step 1.5:

```js
window.SUPABASE_URL = "https://your-project-ref.supabase.co";
window.SUPABASE_ANON_KEY = "your-anon-public-key";
```

The anon key is safe to put in front-end code — on its own it grants no
access; every table and function it touches is still governed by the
policies in `schema.sql`.

## 3. Deploy to Vercel

This is a static site (`index.html`, `app.js`, `config.js`) — no build step.

**Easiest way (Vercel CLI):**

```bash
npm i -g vercel
cd weight-loss-challenge
vercel --prod
```

**Or via GitHub:** push this folder to a GitHub repo, then in Vercel choose
**Add New → Project**, import the repo, and deploy with the default static
settings (no framework, no build command).

Once deployed, go back into Supabase → Authentication → URL Configuration
and make sure the live Vercel URL is in **Redirect URLs**.

## 4. Using it

- **Start the challenge:** one person opens the app, signs in with their
  email (they'll get a magic link), and uses **Start a new challenge** to
  create it. This gives a 6-character join code to share with the family
  (text it, don't need to keep it secret from strangers who'd care, but
  no reason to post it publicly either).
- **Everyone else joins:** they sign in with their own email, then use
  **Join a challenge** with that code, their own display name, and their
  own starting weight.
- **Weekly (or daily) weigh-ins:** each person logs their own weight under
  **Log Weigh-in**. Logging again on the same date overwrites that day's
  entry rather than creating a duplicate.
- **Leaderboard:** ranked by percent of starting weight lost, updates as
  soon as anyone logs a new weigh-in.

## Notes / things you might want to tweak

- **Multiple challenges:** the schema supports more than one challenge (e.g.
  a new one each season) — the app shows a switcher if you're in more than
  one.
- **Rounding for extra privacy:** with only 5–10 people, an exact percentage
  plus someone's known current weight could let a person back-calculate
  pounds lost. If you want more cover, round the leaderboard percentage to
  whole numbers in `get_leaderboard` (change `round(..., 2)` to
  `round(..., 0)`).
- **"% of goal" mode instead of "% of starting weight":** if people have very
  different amounts they want to lose, percent-of-starting-weight can favor
  whoever set the smallest goal. Ask if you want a "percent of a stated goal
  weight reached" variant instead — it's a small change to `get_leaderboard`
  and adds a `goal_weight` column to `participants`.
- **Costs:** Supabase's free tier and Vercel's free tier are both more than
  enough for a family-sized group.
