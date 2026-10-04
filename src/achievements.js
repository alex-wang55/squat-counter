// Each test receives { lifetime, session, mode, holdMs, result }.
export const ACHIEVEMENTS = Object.freeze([
  { id: "first-rep", icon: "👟", name: "First Rep", desc: "Complete your first squat.", test: (c) => c.lifetime.totalReps >= 1 },
  { id: "perfect", icon: "💎", name: "Picture Perfect", desc: "Land a Perfect-depth squat.", test: (c) => c.lifetime.totalPerfect >= 1 },
  { id: "combo-10", icon: "🔥", name: "On Fire", desc: "Reach a 10-rep combo.", test: (c) => c.session.maxCombo >= 10 },
  { id: "combo-25", icon: "☄️", name: "Unstoppable", desc: "Reach a 25-rep combo.", test: (c) => c.session.maxCombo >= 25 },
  { id: "flawless", icon: "✨", name: "Flawless", desc: "Hit 5 Perfect squats in a row.", test: (c) => c.session.maxPerfectStreak >= 5 },
  { id: "century", icon: "💯", name: "Century", desc: "Squat 100 times in total.", test: (c) => c.lifetime.totalReps >= 100 },
  { id: "iron-legs", icon: "🦿", name: "Iron Legs", desc: "Squat 500 times in total.", test: (c) => c.lifetime.totalReps >= 500 },
  { id: "blitz-20", icon: "⚡", name: "Blitz Rookie", desc: "Land 20 reps in a single Blitz.", test: (c) => c.mode === "blitz" && c.session.reps >= 20 },
  { id: "blitz-3000", icon: "🌩️", name: "Blitz Master", desc: "Score 3,000 points in a single Blitz.", test: (c) => c.mode === "blitz" && c.session.score >= 3000 },
  {
    id: "race-60",
    icon: "🏎️",
    name: "Speed Demon",
    desc: "Finish the 20-Rep Race in under a minute.",
    test: (c) => c.result?.mode === "race" && c.result.completed && c.result.timeMs < 60000,
  },
  { id: "hold-30", icon: "🧱", name: "Wall of Steel", desc: "Hold a squat for 30 seconds.", test: (c) => c.holdMs >= 30000 },
  { id: "hold-60", icon: "🪑", name: "Human Chair", desc: "Hold a squat for 60 seconds.", test: (c) => c.holdMs >= 60000 },
]);
