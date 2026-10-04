// Each test receives { lifetime, session, mode, holdMs, result }.
export const ACHIEVEMENTS = Object.freeze([
  { id: "first-rep", name: "First rep", desc: "Complete your first squat.", test: (c) => c.lifetime.totalReps >= 1 },
  { id: "perfect", name: "Perfect form", desc: "Land a Perfect-depth squat.", test: (c) => c.lifetime.totalPerfect >= 1 },
  { id: "combo-10", name: "Combo 10", desc: "Reach a 10-rep combo.", test: (c) => c.session.maxCombo >= 10 },
  { id: "combo-25", name: "Combo 25", desc: "Reach a 25-rep combo.", test: (c) => c.session.maxCombo >= 25 },
  { id: "flawless", name: "Flawless five", desc: "Five Perfect squats in a row.", test: (c) => c.session.maxPerfectStreak >= 5 },
  { id: "century", name: "100 reps", desc: "Squat 100 times in total.", test: (c) => c.lifetime.totalReps >= 100 },
  { id: "iron-legs", name: "500 reps", desc: "Squat 500 times in total.", test: (c) => c.lifetime.totalReps >= 500 },
  { id: "blitz-20", name: "Blitz 20", desc: "Land 20 reps in one Blitz.", test: (c) => c.mode === "blitz" && c.session.reps >= 20 },
  { id: "blitz-3000", name: "Blitz 3,000", desc: "Score 3,000 points in one Blitz.", test: (c) => c.mode === "blitz" && c.session.score >= 3000 },
  {
    id: "race-60",
    name: "Sub-minute race",
    desc: "Finish the Race in under a minute.",
    test: (c) => c.result?.mode === "race" && c.result.completed && c.result.timeMs < 60000,
  },
  { id: "hold-30", name: "30 s hold", desc: "Hold a squat for 30 seconds.", test: (c) => c.holdMs >= 30000 },
  { id: "hold-60", name: "60 s hold", desc: "Hold a squat for 60 seconds.", test: (c) => c.holdMs >= 60000 },
]);
