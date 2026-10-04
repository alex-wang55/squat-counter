export function formatTime(ms, { tenths = false } = {}) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  const sec = tenths
    ? (Math.floor(seconds * 10) / 10).toFixed(1).padStart(4, "0")
    : String(Math.floor(seconds)).padStart(2, "0");
  return `${minutes}:${sec}`;
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString("en-US");
}

export function formatBoardValue(mode, value) {
  return mode.board.format === "time" ? formatTime(value, { tenths: true }) : `${formatNumber(value)} pts`;
}
