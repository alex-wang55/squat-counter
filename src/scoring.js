// Depth tiers are measured as knee flexion past your calibrated standing angle.
// With a typical standing reading of ~172°, Perfect lands around 72° (thighs at
// or below parallel), Great around 87°, Good around 107° (a solid half squat).
// Colors run cool to bright as depth increases, ending on the accent color.
export const TIERS = Object.freeze([
  { id: "perfect", label: "Perfect", minFlex: 100, points: 100, color: "#d4ff3a" },
  { id: "great", label: "Great", minFlex: 85, points: 70, color: "#3ee0a5" },
  { id: "good", label: "Good", minFlex: 65, points: 50, color: "#5b9cff" },
  { id: "shallow", label: "Shallow", minFlex: -Infinity, points: 10, color: "#737373" },
]);

export const DIFFICULTIES = Object.freeze({
  easy: { id: "easy", label: "Easy", offset: -12, hint: "Shallower depth targets. Good for warming up or limited mobility." },
  normal: { id: "normal", label: "Normal", offset: 0, hint: "Perfect means thighs at or just below parallel." },
  hard: { id: "hard", label: "Hard", offset: 8, hint: "Perfect means a deep squat, well below parallel." },
});

function offsetFor(difficulty) {
  return DIFFICULTIES[difficulty]?.offset ?? 0;
}

export function tierFor(flexion, difficulty = "normal") {
  const offset = offsetFor(difficulty);
  return TIERS.find((t) => flexion >= t.minFlex + offset);
}

export function tierThresholds(difficulty = "normal") {
  const offset = offsetFor(difficulty);
  const byId = Object.fromEntries(TIERS.map((t) => [t.id, t.minFlex + offset]));
  return { perfect: byId.perfect, great: byId.great, good: byId.good };
}

// Squat Hold counts while you're at Good depth or deeper.
export function holdThreshold(difficulty = "normal") {
  return tierThresholds(difficulty).good;
}

export const COMBO_STEPS = Object.freeze([
  { at: 20, multiplier: 3 },
  { at: 15, multiplier: 2.5 },
  { at: 10, multiplier: 2 },
  { at: 5, multiplier: 1.5 },
  { at: 0, multiplier: 1 },
]);

export function comboMultiplier(combo) {
  return COMBO_STEPS.find((s) => combo >= s.at).multiplier;
}

// Progress (0-1) toward the next multiplier step, or null at the max.
export function comboProgress(combo) {
  const current = COMBO_STEPS.find((s) => combo >= s.at);
  const idx = COMBO_STEPS.indexOf(current);
  const next = COMBO_STEPS[idx - 1];
  if (!next) return null;
  return (combo - current.at) / (next.at - current.at);
}

export const RANKS = Object.freeze([
  { min: 0, name: "Newbie" },
  { min: 10, name: "Rookie" },
  { min: 50, name: "Regular" },
  { min: 150, name: "Machine" },
  { min: 400, name: "Titan" },
  { min: 1000, name: "Legend" },
]);

export function rankInfo(totalReps) {
  let i = 0;
  RANKS.forEach((r, k) => {
    if (totalReps >= r.min) i = k;
  });
  const rank = RANKS[i];
  const next = RANKS[i + 1] ?? null;
  return {
    rank,
    next,
    progress: next ? (totalReps - rank.min) / (next.min - rank.min) : 1,
    toNext: next ? next.min - totalReps : 0,
  };
}

const GRADES = ["S", "A", "B", "C"];

const GRADE_RULES = {
  // Average depth quality per rep, ignoring combo multipliers.
  free: {
    value: (r) => (r.reps >= 5 ? TIERS.reduce((sum, t) => sum + t.points * r.tiers[t.id], 0) / r.reps : null),
    cuts: [85, 72, 58, 40],
    higher: true,
  },
  blitz: { value: (r) => (r.reps ? r.score : null), cuts: [3500, 2500, 1500, 700], higher: true },
  race: { value: (r) => (r.completed ? r.timeMs : null), cuts: [40000, 55000, 75000, 100000], higher: false },
  hold: { value: (r) => (r.holdMs > 0 ? r.holdMs : null), cuts: [90000, 60000, 40000, 20000], higher: true },
};

export function gradeFor(results) {
  const rule = GRADE_RULES[results.mode];
  const v = rule?.value(results);
  if (v == null) return null;
  const idx = rule.cuts.findIndex((cut) => (rule.higher ? v >= cut : v <= cut));
  return idx === -1 ? "D" : GRADES[idx];
}
