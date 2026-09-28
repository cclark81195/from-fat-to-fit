// From Fat to Fit — quote banks
//
// Everything here is picked deterministically from the calendar date, so:
//   - the daily motivational quote is the same for everyone on a given day,
//     and changes automatically at midnight (no server/cron needed)
//   - the leaderboard's "first place" / "last place" quotes stay stable
//     through the day instead of re-rolling on every refresh
//
// dayIndex(date) turns a date into a stable integer; pickForDay() uses it
// to index into a list. Swap or extend any list freely.

function dayIndex(date) {
  // Days since a fixed epoch — stable across time zones for a given
  // calendar date string (YYYY-MM-DD), which is all that matters here.
  const epoch = Date.UTC(2020, 0, 1);
  const d = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((d - epoch) / 86400000);
}

function pickForDay(list, date, salt = 0) {
  const idx = (dayIndex(date) + salt) % list.length;
  return list[(idx + list.length) % list.length];
}

window.QUOTES = {
  daily: [
    "Every pound you let go of is a step toward the person you're becoming.",
    "Progress isn't always visible on the scale — but it's happening in every choice you make today.",
    "You don't have to be extreme, just consistent.",
    "Small daily improvements are the key to staggering long-term results.",
    "The best project you'll ever work on is you.",
    "Discipline is choosing between what you want now and what you want most.",
    "You didn't come this far to only come this far.",
    "Your body can do it. It's your mind you need to convince.",
    "One healthy choice leads to another. Start the chain today.",
    "Strength doesn't come from what you can do — it comes from overcoming what you thought you couldn't.",
    "Today's effort is tomorrow's strength.",
    "Motivation gets you started. Habit keeps you going.",
    "You are not starting over — you are starting from experience.",
    "Every workout is progress, no matter how small it feels.",
    "The pain of discipline weighs ounces; the pain of regret weighs tons.",
    "Focus on progress, not perfection.",
    "Success is the sum of small efforts repeated day in and day out.",
    "It's not about having time, it's about making time.",
    "You are one decision away from a totally different life.",
    "Believe you can, and you're halfway there.",
    "Take care of your body. It's the only place you have to live.",
    "The only bad workout is the one that didn't happen.",
    "A year from now you'll wish you had started today.",
    "Fall in love with taking care of yourself.",
    "Your future self is watching you right now through memories.",
    "Don't wish for it. Work for it.",
    "Consistency is what transforms average into excellence.",
    "Slow progress is still progress. Keep showing up.",
    "You're not just losing weight — you're gaining a healthier life.",
    "The hardest lift of the day is lifting yourself off the couch. Do that, and the rest follows.",
  ],

  // {name} is replaced with the display name of whoever is currently #1
  firstPlace: [
    "👑 {name} is leading the pack — that's what consistency looks like!",
    "🔥 {name} is on fire this challenge. Everyone else, this is the pace to chase!",
    "🏅 {name} is proof that showing up every day pays off. Incredible work.",
    "⭐ {name} is setting the bar high — a true inspiration to the whole family.",
    "🚀 {name} is out in front and still climbing. Keep it up!",
    "💯 {name} is turning effort into results. Way to lead the way!",
    "🏆 {name} didn't get to the top by accident — that's discipline in action.",
    "🌟 {name} is the one to beat this week — nothing but respect.",
  ],

  // {name} is replaced with the display name of whoever is currently last
  lastPlace: [
    "💪 {name}, the scoreboard doesn't measure heart — keep showing up, the results will follow.",
    "🌱 {name}, every journey has a slower start. What matters is you're still in it.",
    "🔥 {name}, today is a great day for a comeback. One good choice changes the momentum.",
    "🙌 {name}, the family's rooting for you — small steps still count as steps forward.",
    "⏳ {name}, this challenge isn't over. There's plenty of time to climb.",
    "💚 {name}, progress isn't a straight line. Keep going — you've got this.",
    "✨ {name}, the comeback is always stronger than the setback. Let's go!",
    "🏋️ {name}, last place today doesn't mean last place tomorrow. Keep pushing.",
  ],
};

// Convenience helpers used by app.js
window.getDailyQuote = function (date = new Date()) {
  return pickForDay(window.QUOTES.daily, date);
};
window.getFirstPlaceQuote = function (name, date = new Date()) {
  return pickForDay(window.QUOTES.firstPlace, date, 7).replace("{name}", name);
};
window.getLastPlaceQuote = function (name, date = new Date()) {
  return pickForDay(window.QUOTES.lastPlace, date, 13).replace("{name}", name);
};
