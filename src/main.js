import { measurePose } from "./pose.js";
import { SquatDetector, DETECTOR_DEFAULTS } from "./detector.js";
import { Game, MODES } from "./game.js";
import { ACHIEVEMENTS } from "./achievements.js";
import { TIERS, DIFFICULTIES, tierFor, tierThresholds, holdThreshold, comboMultiplier, comboProgress, rankInfo } from "./scoring.js";
import { createStore, memoryBackend } from "./storage.js";
import { Sfx } from "./audio.js";
import { Particles, drawSkeleton, drawDemoBackdrop } from "./render.js";
import { DemoSource } from "./demo.js";
import { formatTime, formatNumber, formatBoardValue } from "./format.js";

const $ = (id) => document.getElementById(id);

const el = {
  stage: $("stage"),
  video: $("video"),
  canvas: $("overlay"),
  hudMode: $("hud-mode"),
  hudTimer: $("hud-timer"),
  hudProgress: $("hud-progress"),
  hudDemo: $("hud-demo"),
  combo: $("combo"),
  comboCount: $("combo-count"),
  comboMult: $("combo-mult"),
  comboBarFill: $("combo-bar-fill"),
  gauge: $("gauge"),
  gaugeTrack: $("gauge-track"),
  gaugeFill: $("gauge-fill"),
  gaugeMax: $("gauge-max"),
  gaugeLabels: $("gauge-labels"),
  holdPrompt: $("hold-prompt"),
  goBanner: $("go-banner"),
  popupLayer: $("popup-layer"),
  screens: {
    start: $("screen-start"),
    loading: $("screen-loading"),
    calibrate: $("screen-calibrate"),
    countdown: $("screen-countdown"),
    results: $("screen-results"),
    error: $("screen-error"),
  },
  startIcon: $("start-icon"),
  startTitle: $("start-title"),
  startDesc: $("start-desc"),
  startPlay: $("start-play"),
  startAlt: $("start-alt"),
  loadingText: $("loading-text"),
  calibProgress: $("calib-progress"),
  calibHint: $("calib-hint"),
  countdownNum: $("countdown-num"),
  resBest: $("res-best"),
  resGrade: $("res-grade"),
  resTitle: $("res-title"),
  resMain: $("res-main"),
  resSub: $("res-sub"),
  resStats: $("res-stats"),
  resTierbar: $("res-tierbar"),
  resAgain: $("res-again"),
  resMenu: $("res-menu"),
  errorTitle: $("error-title"),
  errorText: $("error-text"),
  errorRetry: $("error-retry"),
  errorDemo: $("error-demo"),
  feedback: $("feedback"),
  statScore: $("stat-score"),
  statReps: $("stat-reps"),
  statCombo: $("stat-combo"),
  statAngle: $("stat-angle"),
  tierCounts: Object.fromEntries(TIERS.map((t) => [t.id, $(`tier-${t.id}`)])),
  playBtn: $("play-btn"),
  endBtn: $("end-btn"),
  sourceBtn: $("source-btn"),
  modeList: $("mode-list"),
  board: $("board"),
  boardMode: $("board-mode"),
  achievements: $("achievements"),
  achCount: $("ach-count"),
  rankChip: $("rank-chip"),
  rankEmoji: $("rank-emoji"),
  rankName: $("rank-name"),
  rankBarFill: $("rank-bar-fill"),
  rankNext: $("rank-next"),
  soundBtn: $("sound-btn"),
  difficulty: $("difficulty"),
  difficultyHint: $("difficulty-hint"),
  modelSelect: $("model-select"),
  resetProgress: $("reset-progress"),
  toasts: $("toasts"),
};

const TIER_COLOR = Object.fromEntries(TIERS.map((t) => [t.id, t.color]));
const NEUTRAL_LEG = "#7dd3fc";
const LOST_LEG = "#f87171";
const GAUGE_MAX = 125;
const RING_CIRCUMFERENCE = 2 * Math.PI * 44;

const BURSTS = {
  perfect: { count: 48, colors: ["#f472b6", "#fbbf24", "#38bdf8", "#4ade80", "#ffffff"], speed: 430, size: 9, life: 1.3 },
  great: { count: 28, colors: ["#fbbf24", "#fde68a", "#ffffff"], speed: 330, size: 7, life: 1 },
  good: { count: 14, colors: ["#4ade80", "#bbf7d0"], speed: 250, size: 6, life: 0.8 },
};

const TRACKING_MESSAGES = {
  noPerson: "No one in view — step into the frame.",
  outOfFrame: "Part of your legs is out of frame — step back until your feet are in view.",
  tooSmall: "You're quite far away — step a little closer.",
  visibility: "Can't see your legs clearly — try brighter light or turn side-on.",
  implausible: "That pose looks off — stand upright, side-on to the camera.",
  notUpright: "Keep your head and shoulders in view and stand upright.",
};

const REJECT_MESSAGES = {
  tooFast: "Too quick to count — control the way down.",
  tooSlow: "That one took over 10 seconds, so it didn't count.",
  noHipDrop: "That looked like a knee lift — sit your hips back and down.",
  lost: "Lost sight of your legs mid-rep — that one didn't count.",
};

const REP_MESSAGES = {
  perfect: (e) => `Perfect depth (${Math.round(e.minAngle)}°) — textbook! 🔥`,
  great: (e) => `Great rep — ${Math.round(e.minAngle)}° at the bottom.`,
  good: () => "Good rep. Sink a little lower for Great.",
  shallow: (e) => `Too shallow (${Math.round(e.minAngle)}°) — squat lower to keep your combo.`,
};

// ---------- state ----------

const store = createStore();
const settings = { mode: "free", difficulty: "normal", model: "full", sound: true, ...store.get("settings", {}) };
if (!MODES[settings.mode]) settings.mode = "free";
if (!DIFFICULTIES[settings.difficulty]) settings.difficulty = "normal";

const sfx = new Sfx();
sfx.muted = !settings.sound;
const realGame = new Game(store);
let demoGame = null;
let game = realGame;
const detector = new SquatDetector();
const particles = new Particles();
const ctx = el.canvas.getContext("2d");

let source = null; // "camera" | "demo" | null
let landmarker = null;
let landmarkerModel = null;
let demo = null;
let aspect = 4 / 3;
let lastVideoTime = -1;
let lastResult = null;
let lastMeasure = null;
let lastFrameT = performance.now();
let loopStarted = false;
let busy = false;

const saveSettings = () => store.set("settings", settings);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const now = () => performance.now();

// ---------- sources ----------

async function ensureModel() {
  if (landmarker && landmarkerModel === settings.model) return;
  showScreen("loading");
  el.loadingText.textContent = `Loading ${settings.model === "full" ? "accurate" : "fast"} pose model…`;
  const { createLandmarker } = await import("./landmarker.js");
  const next = await createLandmarker(settings.model);
  landmarker?.close();
  landmarker = next;
  landmarkerModel = settings.model;
}

async function startCamera() {
  let stage = "model";
  try {
    await ensureModel();
    stage = "camera";
    showScreen("loading");
    el.loadingText.textContent = "Waiting for camera permission…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    el.video.srcObject = stream;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopSource();
      setFeedback("Camera disconnected.", "warn");
    });
    if (el.video.readyState < 1) {
      await new Promise((resolve) => el.video.addEventListener("loadedmetadata", resolve, { once: true }));
    }
    await el.video.play().catch(() => {});
    configureStage(el.video.videoWidth || 640, el.video.videoHeight || 480);
    source = "camera";
    game = realGame;
    el.video.hidden = false;
    el.hudDemo.hidden = true;
    renderPanel();
    startLoop();
    return true;
  } catch (err) {
    console.error(err);
    showError(stage, err);
    return false;
  }
}

function stopCameraTracks() {
  el.video.srcObject?.getTracks().forEach((track) => track.stop());
  el.video.srcObject = null;
}

function startDemo() {
  sfx.unlock();
  if (game.active) handleGameEvents(game.reset());
  if (source === "camera") stopCameraTracks();
  source = "demo";
  demo = new DemoSource();
  demoGame ??= new Game(createStore(memoryBackend()));
  game = demoGame;
  configureStage(640, 480);
  el.video.hidden = true;
  el.hudDemo.hidden = false;
  renderPanel();
  startLoop();
  startSession();
}

function stopSource() {
  const wasDemo = source === "demo";
  if (source === "camera") stopCameraTracks();
  game.reset();
  source = null;
  demo = null;
  lastResult = null;
  lastMeasure = null;
  game = realGame;
  game.reset();
  el.video.hidden = false;
  el.hudDemo.hidden = true;
  particles.clear();
  el.popupLayer.replaceChildren();
  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  onState("idle");
  renderPanel();
  setFeedback(wasDemo ? "Demo over — ready when you are." : "Camera stopped.");
}

function configureStage(w, h) {
  el.canvas.width = w;
  el.canvas.height = h;
  aspect = w / h;
  el.stage.style.setProperty("--aspect", String(aspect));
}

// ---------- session flow ----------

async function play() {
  if (busy || game.active) return;
  sfx.unlock();
  busy = true;
  renderControls();
  try {
    if (!source) {
      if (!(await startCamera())) return;
    } else if (source === "camera" && landmarkerModel !== settings.model) {
      try {
        await ensureModel();
      } catch (err) {
        console.error(err);
        showError("model", err);
        return;
      }
    }
    startSession();
  } finally {
    busy = false;
    renderControls();
  }
}

function startSession() {
  const t = now();
  detector.recalibrate();
  particles.clear();
  el.popupLayer.replaceChildren();
  if (source === "demo") demo.restart({ script: settings.mode === "hold" ? "hold" : "reps" });
  handleGameEvents(game.start(settings.mode, settings.difficulty));
  configureGauge();
  renderStats();
}

function endRun() {
  if (game.active) handleGameEvents(game.end(now()));
}

function selectMode(id) {
  if (game.active || !MODES[id]) return;
  settings.mode = id;
  saveSettings();
  if (game.state === "finished") game.reset();
  onState(game.state);
  renderModes();
  renderBoard();
  renderStats();
}

// ---------- main loop ----------

function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  lastFrameT = now();
  requestAnimationFrame(loop);
}

function loop() {
  requestAnimationFrame(loop);
  const t = now();
  const dt = Math.min(0.05, (t - lastFrameT) / 1000);
  lastFrameT = t;

  let result = null;
  if (source === "camera" && landmarker && el.video.readyState >= 2 && el.video.currentTime !== lastVideoTime) {
    lastVideoTime = el.video.currentTime;
    result = landmarker.detectForVideo(el.video, t);
  } else if (source === "demo") {
    result = demo.frame(t);
  }

  if (result) {
    lastResult = result;
    lastMeasure = measurePose(result, aspect);
    for (const e of detector.update(lastMeasure, t)) {
      onDetectorEvent(e);
      handleGameEvents(game.handle(e, t));
    }
  }
  if (source) handleGameEvents(game.update(t, detector.state));

  renderCanvas(dt);
  renderHud(t);
}

// ---------- events ----------

function onDetectorEvent(e) {
  if (e.type === "trackingLost" && game.state !== "calibrating") {
    setFeedback(TRACKING_MESSAGES[e.reason] ?? TRACKING_MESSAGES.visibility, "warn");
  } else if (e.type === "trackingRegained" && game.state === "playing") {
    setFeedback("Back in view — keep going!");
  } else if (e.type === "calibrated") {
    sfx.tick();
  }
}

function handleGameEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case "state":
        onState(e.state);
        break;
      case "countdown":
        el.countdownNum.textContent = String(e.n);
        restartAnimation(el.countdownNum);
        sfx.countdown();
        break;
      case "go":
        if (source === "demo") demo.begin(now());
        el.goBanner.hidden = false;
        restartAnimation(el.goBanner);
        sfx.go();
        setFeedback(goMessage());
        break;
      case "rep":
        onRep(e);
        break;
      case "multiplier":
        popup(`×${e.multiplier} MULTIPLIER`, "mult", { x: 0.5, y: 0.3 });
        restartAnimation(el.combo, "bump");
        sfx.multiplier();
        break;
      case "comboBroken":
        setFeedback(`Combo of ${e.combo} broken — go deeper to keep it alive.`, "warn");
        sfx.comboBreak();
        break;
      case "rankUp":
        toast(`${e.rank.emoji} Rank up!`, `You're now a ${e.rank.name}.`, "Rank");
        renderRank(true);
        break;
      case "achievement":
        toast(`${e.achievement.icon} ${e.achievement.name}`, e.achievement.desc, game === demoGame ? "Achievement (demo)" : "Achievement unlocked");
        sfx.achievement();
        renderAchievements();
        break;
      case "holdStart":
        setFeedback("Clock is running — hold it!");
        sfx.go();
        break;
      case "holdTick":
        if (e.seconds % 10 === 0) {
          popup(`${e.seconds}s!`, "hold", { x: 0.5, y: 0.3 });
          setFeedback(e.seconds >= 30 ? `${e.seconds} seconds — legs of steel! 🧱` : `${e.seconds} seconds — keep breathing, stay low.`);
          sfx.multiplier();
        } else {
          sfx.tick();
        }
        break;
      case "holdEnd":
        sfx.comboBreak();
        break;
      case "rejected":
        setFeedback(REJECT_MESSAGES[e.reason] ?? "That rep didn't count.", "warn");
        break;
      case "finished":
        showResults(e.results);
        sfx.finish();
        renderBoard();
        renderModes();
        break;
    }
  }
}

function onState(state) {
  el.stage.dataset.state = state;
  if (state === "idle") {
    updateStartScreen();
    showScreen("start");
  } else if (state === "calibrating") {
    showScreen("calibrate");
    setFeedback("Calibrating — stand tall and still for a second.");
  } else if (state === "countdown") {
    showScreen("countdown");
    setFeedback("Get ready…");
  } else if (state === "playing") {
    showScreen(null);
  }
  const mode = MODES[settings.mode];
  const live = state === "countdown" || state === "playing";
  el.hudMode.textContent = mode.name;
  el.hudTimer.hidden = !(live || state === "finished");
  el.hudProgress.hidden = !(mode.id === "race" && (live || state === "finished"));
  el.gauge.hidden = !live;
  el.combo.hidden = !(state === "playing" && mode.id !== "hold");
  el.holdPrompt.hidden = !(state === "playing" && mode.id === "hold");
  renderControls();
  renderModes();
  renderDifficulty();
}

function onRep(e) {
  const anchor = lastMeasure?.ok ? lastMeasure.anchor : { x: 0.5, y: 0.5 };
  const sub = e.multiplier > 1 ? `${e.tier.label} ×${e.multiplier}` : e.tier.label;
  popup(`+${formatNumber(e.points)}`, e.tier.id, anchor, sub);
  const burst = BURSTS[e.tier.id];
  if (burst) {
    particles.burst(anchor.x * el.canvas.width, anchor.y * el.canvas.height, { ...burst, scale: el.canvas.width / 640 });
  }
  flash(e.tier.id);
  sfx.rep(e.tier.id);
  const raceShallow = game.mode.id === "race" && e.tier.id === "shallow";
  setFeedback(raceShallow ? "Too shallow — that one doesn't count toward 20." : REP_MESSAGES[e.tier.id](e), e.tier.id === "shallow" ? "warn" : "good");
  renderStats();
  restartAnimation(el.statScore.parentElement, "bump");
}

function goMessage() {
  switch (game.mode.id) {
    case "blitz":
      return "GO! Deep reps and long combos score the most.";
    case "race":
      return "GO! 20 good reps — shallow ones don't count.";
    case "hold":
      return "Sink to Good depth or lower and hold it.";
    default:
      return "GO! Squat to depth to start a combo.";
  }
}

// ---------- rendering ----------

function renderCanvas(dt) {
  const { width: w, height: h } = el.canvas;
  ctx.clearRect(0, 0, w, h);
  if (source === "demo") drawDemoBackdrop(ctx, w, h);
  const lms = lastResult?.landmarks?.[0];
  if (source && lms) {
    drawSkeleton(ctx, lms, { w, h, legColor: legColor(), dim: !lastMeasure?.ok });
  }
  particles.step(dt);
  particles.draw(ctx);
}

function legColor() {
  if (!lastMeasure?.ok) return LOST_LEG;
  const det = detector.state;
  if (!det.calibrated || det.flexion < DETECTOR_DEFAULTS.startFlex) return NEUTRAL_LEG;
  return tierFor(det.flexion, settings.difficulty).color;
}

function renderHud(t) {
  const det = detector.state;
  el.statAngle.textContent = source && det.tracking && det.angle != null ? `${Math.round(det.angle)}°` : "—";

  if (game.state === "calibrating") {
    el.calibProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - det.calibrationProgress));
    el.calibHint.textContent = calibrationHint(det);
    return;
  }
  const hud = game.hud(t);
  if (!el.hudTimer.hidden) {
    el.hudTimer.textContent =
      hud.kind === "remaining" ? formatTime(Math.ceil(hud.timer / 1000) * 1000) : formatTime(hud.timer, { tenths: game.mode.id !== "free" });
    el.hudTimer.classList.toggle("urgent", hud.kind === "remaining" && game.state === "playing" && hud.timer <= 10000);
    el.hudTimer.classList.toggle("holding", Boolean(hud.holding));
  }
  if (!el.hudProgress.hidden) {
    el.hudProgress.textContent = `${game.session.goodReps}/${game.mode.targetReps}`;
  }
  if (!el.gauge.hidden) renderGauge(det);
  if (!el.holdPrompt.hidden) {
    el.holdPrompt.textContent = hud.holding ? "Hold it! Stay at or below the HOLD line" : "Squat to the HOLD line to start the clock";
    el.holdPrompt.classList.toggle("active", hud.holding);
  }
  if (!el.combo.hidden) {
    const combo = game.session.combo;
    el.comboCount.textContent = String(combo);
    const mult = comboMultiplier(combo);
    el.comboMult.textContent = `×${mult}`;
    el.combo.dataset.level = String(mult);
    const progress = comboProgress(combo);
    el.comboBarFill.style.width = `${(progress ?? 1) * 100}%`;
  }
}

function calibrationHint(det) {
  if (!lastMeasure) return "Waiting for the camera…";
  if (!lastMeasure.ok) return TRACKING_MESSAGES[lastMeasure.reason] ?? TRACKING_MESSAGES.visibility;
  if (det.calibrationProgress > 0) return "Hold still…";
  return "Straighten your legs and stand tall.";
}

function configureGauge() {
  const th = tierThresholds(settings.difficulty);
  const pct = (v) => clamp((v / GAUGE_MAX) * 100, 0, 100);
  const target = game.mode.id === "hold" ? holdThreshold(settings.difficulty) : null;
  el.gaugeTrack.style.background = `linear-gradient(to top,
    rgba(148, 163, 184, 0.18) 0 ${pct(th.good)}%,
    rgba(74, 222, 128, 0.22) ${pct(th.good)}% ${pct(th.great)}%,
    rgba(251, 191, 36, 0.24) ${pct(th.great)}% ${pct(th.perfect)}%,
    rgba(244, 114, 182, 0.28) ${pct(th.perfect)}% 100%)`;
  const labels = [
    ["PERFECT", th.perfect, "perfect"],
    ["GREAT", th.great, "great"],
    [target != null ? "HOLD" : "GOOD", th.good, "good"],
  ];
  el.gaugeLabels.replaceChildren(
    ...labels.map(([text, value, tier]) => {
      const span = document.createElement("span");
      span.className = `gauge-label c-${tier}`;
      span.textContent = text;
      span.style.bottom = `${pct(value)}%`;
      return span;
    })
  );
}

function renderGauge(det) {
  const pct = clamp((det.flexion / GAUGE_MAX) * 100, 0, 100);
  el.gaugeFill.style.height = `${det.tracking ? pct : 0}%`;
  const color = det.flexion < DETECTOR_DEFAULTS.startFlex ? NEUTRAL_LEG : tierFor(det.flexion, settings.difficulty).color;
  el.gaugeFill.style.background = color;
  el.gaugeFill.style.color = color;
  const max = det.repMaxFlexion;
  el.gaugeMax.hidden = !(det.phase === "down" && max > 0);
  el.gaugeMax.style.bottom = `${clamp((max / GAUGE_MAX) * 100, 0, 100)}%`;
}

function renderStats() {
  const s = game.session;
  el.statScore.textContent = formatNumber(s.score);
  el.statReps.textContent = String(s.reps);
  el.statCombo.textContent = String(s.maxCombo);
  for (const t of TIERS) el.tierCounts[t.id].textContent = String(s.tiers[t.id]);
}

function renderControls() {
  const active = game.active;
  el.playBtn.disabled = active || busy;
  el.playBtn.textContent = source === "demo" ? "Run demo" : "Play";
  el.endBtn.disabled = !active;
  el.sourceBtn.disabled = !source;
  el.sourceBtn.textContent = source === "demo" ? "Exit demo" : "Stop camera";
  el.modelSelect.disabled = active;
  el.resetProgress.disabled = active;
}

function renderModes() {
  el.modeList.replaceChildren(
    ...Object.values(MODES).map((mode) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mode-card";
      btn.dataset.mode = mode.id;
      btn.setAttribute("aria-pressed", String(mode.id === settings.mode));
      btn.disabled = game.active && mode.id !== settings.mode;
      const best = game.boards[mode.id][0];
      const parts = [
        ["mode-icon", mode.icon],
        ["mode-name", mode.name],
        ["mode-short", mode.short],
        ["mode-best", best ? `Best: ${formatBoardValue(mode, best.value)}` : "No record yet"],
      ];
      for (const [cls, text] of parts) {
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = text;
        btn.append(span);
      }
      btn.addEventListener("click", () => selectMode(mode.id));
      return btn;
    })
  );
}

function renderBoard() {
  const mode = MODES[settings.mode];
  el.boardMode.textContent = mode.name + (game === demoGame ? " · demo" : "");
  const list = game.boards[mode.id] ?? [];
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "board-empty";
    li.textContent = "No runs yet — set the first record!";
    el.board.replaceChildren(li);
    return;
  }
  el.board.replaceChildren(
    ...list.map((entry) => {
      const li = document.createElement("li");
      li.classList.toggle("latest", entry.id === game.lastEntryId);
      const value = document.createElement("span");
      value.className = "board-value";
      value.textContent = formatBoardValue(mode, entry.value);
      const meta = document.createElement("span");
      meta.className = "board-meta";
      const date = new Date(entry.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      meta.textContent = `${DIFFICULTIES[entry.difficulty]?.label ?? ""} · ${date}`;
      li.append(value, meta);
      return li;
    })
  );
}

function renderAchievements() {
  el.achievements.replaceChildren(
    ...ACHIEVEMENTS.map((a) => {
      const li = document.createElement("li");
      const unlocked = game.unlocked.has(a.id);
      li.className = `ach${unlocked ? " unlocked" : ""}`;
      li.title = `${a.name} — ${a.desc}${unlocked ? "" : " (locked)"}`;
      const icon = document.createElement("span");
      icon.className = "ach-icon";
      icon.textContent = a.icon;
      const name = document.createElement("span");
      name.className = "ach-name";
      name.textContent = a.name;
      li.append(icon, name);
      return li;
    })
  );
  el.achCount.textContent = `${game.unlocked.size}/${ACHIEVEMENTS.length}`;
}

function renderRank(celebrate = false) {
  const info = rankInfo(game.lifetime.totalReps);
  el.rankEmoji.textContent = info.rank.emoji;
  el.rankName.textContent = info.rank.name;
  el.rankBarFill.style.width = `${info.progress * 100}%`;
  el.rankNext.textContent = info.next
    ? `${info.toNext} squat${info.toNext === 1 ? "" : "s"} to ${info.next.emoji} ${info.next.name}`
    : "Max rank — legendary.";
  if (celebrate) restartAnimation(el.rankChip, "bump");
}

function renderDifficulty() {
  el.difficulty.replaceChildren(
    ...Object.values(DIFFICULTIES).map((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(d.id === settings.difficulty));
      btn.textContent = d.label;
      btn.disabled = game.active;
      btn.addEventListener("click", () => {
        settings.difficulty = d.id;
        saveSettings();
        renderDifficulty();
        configureGauge();
      });
      return btn;
    })
  );
  el.difficultyHint.textContent = DIFFICULTIES[settings.difficulty].hint;
}

function renderPanel() {
  renderStats();
  renderModes();
  renderBoard();
  renderAchievements();
  renderRank();
  renderControls();
  updateStartScreen();
}

function updateStartScreen() {
  const mode = MODES[settings.mode];
  el.startIcon.textContent = mode.icon;
  el.startTitle.textContent = mode.name;
  el.startDesc.textContent = mode.desc;
  el.startPlay.textContent = source === "demo" ? "Run the demo" : source === "camera" ? "Play" : "Start camera & play";
  el.startAlt.textContent = source === "demo" ? "Use my camera instead" : "No camera? Watch a demo run";
  el.startAlt.hidden = source === "camera";
}

function showScreen(name) {
  for (const [key, node] of Object.entries(el.screens)) node.hidden = key !== name;
}

function showError(stage, err) {
  const messages = {
    NotAllowedError: "Camera access was blocked. Allow it in your browser's site settings, then try again.",
    NotFoundError: "No camera was found on this device.",
    NotReadableError: "Your camera is busy — close other apps or tabs using it, then try again.",
    OverconstrainedError: "Your camera doesn't support the requested settings.",
    SecurityError: "Camera access needs a secure (https) page.",
  };
  el.errorTitle.textContent = stage === "model" ? "Couldn't load the pose model" : "Camera unavailable";
  el.errorText.textContent =
    stage === "model"
      ? "Check your internet connection and try again — the model downloads the first time you play."
      : messages[err?.name] ?? `Something went wrong starting the camera (${err?.message ?? "unknown error"}).`;
  showScreen("error");
  renderControls();
}

function showResults(r) {
  const titles = {
    free: "Session complete",
    blitz: "Time's up!",
    race: r.completed ? "Race finished!" : "Race abandoned",
    hold: "Hold broken!",
  };
  el.resTitle.textContent = titles[r.mode];
  el.resGrade.textContent = r.grade ?? (r.mode === "race" && !r.completed ? "DNF" : "—");
  el.resGrade.dataset.grade = r.grade ?? "none";
  el.resBest.hidden = !r.newBest;

  if (r.mode === "race") {
    el.resMain.textContent = r.completed ? formatTime(r.timeMs, { tenths: true }) : `${r.goodReps}/${MODES.race.targetReps} reps`;
  } else if (r.mode === "hold") {
    el.resMain.textContent = formatTime(r.holdMs, { tenths: true });
  } else {
    el.resMain.textContent = `${formatNumber(r.score)} pts`;
  }

  if (r.newBest) el.resSub.textContent = "A new personal best!";
  else if (r.boardRank) el.resSub.textContent = `#${r.boardRank} on your leaderboard`;
  else if (r.mode === "free" && r.reps < 5) el.resSub.textContent = "Do at least 5 reps to earn a grade.";
  else el.resSub.textContent = "";

  const rows =
    r.mode === "hold"
      ? [
          ["Difficulty", DIFFICULTIES[r.difficulty].label],
          ["Personal best", game.boards.hold[0] ? formatBoardValue(MODES.hold, game.boards.hold[0].value) : "—"],
        ]
      : [
          ["Reps", String(r.reps)],
          ["Perfect", String(r.tiers.perfect)],
          ["Max combo", String(r.maxCombo)],
          ["Avg depth", r.avgAngle != null ? `${Math.round(r.avgAngle)}°` : "—"],
        ];
  el.resStats.replaceChildren(
    ...rows.map(([label, value]) => {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      div.append(dt, dd);
      return div;
    })
  );

  el.resTierbar.hidden = r.reps === 0;
  el.resTierbar.replaceChildren(
    ...TIERS.filter((t) => r.tiers[t.id] > 0).map((t) => {
      const seg = document.createElement("span");
      seg.style.flexGrow = String(r.tiers[t.id]);
      seg.style.background = t.color;
      seg.title = `${t.label}: ${r.tiers[t.id]}`;
      return seg;
    })
  );
  showScreen("results");
}

function setFeedback(text, tone = "") {
  el.feedback.textContent = text;
  el.feedback.dataset.tone = tone;
}

function popup(text, kind, anchor, sub) {
  const node = document.createElement("div");
  node.className = `popup popup-${kind}`;
  const main = document.createElement("span");
  main.className = "popup-main";
  main.textContent = text;
  node.append(main);
  if (sub) {
    const s = document.createElement("span");
    s.className = "popup-sub";
    s.textContent = sub;
    node.append(s);
  }
  // The video is mirrored, so flip x to line up with the player on screen.
  node.style.left = `${clamp(1 - anchor.x, 0.18, 0.82) * 100}%`;
  node.style.top = `${clamp(anchor.y, 0.2, 0.8) * 100}%`;
  el.popupLayer.append(node);
  node.addEventListener("animationend", () => node.remove(), { once: true });
}

function flash(tier) {
  el.stage.dataset.flash = tier;
  restartAnimation(el.stage, "flash");
}

function restartAnimation(node, cls = "animate") {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

function toast(title, body, kicker) {
  const node = document.createElement("div");
  node.className = "toast";
  const k = document.createElement("span");
  k.className = "toast-kicker";
  k.textContent = kicker;
  const strong = document.createElement("strong");
  strong.textContent = title;
  const p = document.createElement("span");
  p.textContent = body;
  node.append(k, strong, p);
  el.toasts.append(node);
  setTimeout(() => {
    node.classList.add("out");
    node.addEventListener("animationend", () => node.remove(), { once: true });
  }, 3400);
}

// ---------- wiring ----------

el.startPlay.addEventListener("click", () => (source === "demo" ? startSession() : play()));
el.startAlt.addEventListener("click", () => {
  if (source === "demo") {
    stopSource();
    play();
  } else {
    startDemo();
  }
});
el.playBtn.addEventListener("click", () => (source === "demo" ? startSession() : play()));
el.endBtn.addEventListener("click", endRun);
el.sourceBtn.addEventListener("click", stopSource);
el.resAgain.addEventListener("click", startSession);
el.resMenu.addEventListener("click", () => {
  game.reset();
  onState("idle");
  el.modeList.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
el.errorRetry.addEventListener("click", play);
el.errorDemo.addEventListener("click", startDemo);
el.goBanner.addEventListener("animationend", () => (el.goBanner.hidden = true));

el.soundBtn.addEventListener("click", () => {
  settings.sound = !settings.sound;
  sfx.muted = !settings.sound;
  if (settings.sound) sfx.unlock();
  saveSettings();
  renderSound();
});

el.modelSelect.value = settings.model;
el.modelSelect.addEventListener("change", () => {
  settings.model = el.modelSelect.value;
  saveSettings();
  if (source === "camera") setFeedback("New tracking model loads when you start the next run.");
});

el.resetProgress.addEventListener("click", () => {
  if (game.active) return;
  if (!confirm("Reset your leaderboards, achievements and rank on this device?")) return;
  game.resetProgress();
  renderPanel();
  setFeedback("Progress reset. Fresh start!");
});

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea, button, summary")) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (game.active) return;
    if (source === "demo") startSession();
    else play();
  } else if (e.code === "Escape") {
    endRun();
  }
});

function renderSound() {
  el.soundBtn.textContent = settings.sound ? "🔊" : "🔇";
  el.soundBtn.setAttribute("aria-pressed", String(settings.sound));
  el.soundBtn.setAttribute("aria-label", settings.sound ? "Sound on" : "Sound off");
}

renderSound();
renderDifficulty();
renderPanel();
configureGauge();
onState("idle");
startLoop();
