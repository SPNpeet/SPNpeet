/**
 * Smart segment selection — chooses where to cut the source so the
 * output hits the target duration while staying near natural boundaries
 * (scene changes & silences) instead of slicing mid-sentence.
 */

const MIN_SEG = 8;     // minimum segment length (seconds)
const MAX_SEG = 35;    // maximum segment length (seconds)
const MAX_SEGS = 14;

/**
 * @param {object} meta    { duration, ... } from analyze.probe()
 * @param {number} target  Desired output duration (seconds)
 * @param {array}  scenes  Scene-change timestamps (seconds) — optional
 * @param {array}  silences  [{start,end}] silence ranges — optional
 * @returns {array<{start,end,kind}>}
 */
export function chooseSegments(meta, target, scenes = [], silences = []) {
  const src = meta.duration;
  if (src <= target * 1.1) return [{ start: 0, end: src, kind: "full" }];

  const segCount = Math.min(MAX_SEGS, Math.max(2, Math.ceil(target / MAX_SEG)));
  const segDur   = Math.min(MAX_SEG, Math.max(MIN_SEG, target / segCount));
  const usable   = src * 0.96; // skip last ~4% (credits, fade)

  // Compute ideal starts evenly spread; then snap each to nearest scene
  // change within a ±2s window.
  const gap = (usable - segDur * segCount) / Math.max(segCount - 1, 1);

  const result = [];
  for (let i = 0; i < segCount; i++) {
    const idealStart = i * (segDur + gap);
    const snapStart  = snapToBoundary(idealStart, scenes, silences, 2.0);
    const start      = Math.max(0, Math.min(src - segDur, snapStart));
    const end        = Math.min(src, start + segDur);
    result.push({ start: round(start), end: round(end), kind: i === 0 ? "hook" : i === segCount - 1 ? "outro" : "body" });
  }
  return result;
}

function snapToBoundary(t, scenes, silences, window) {
  // Prefer a scene start within window
  let best = t;
  let bestDist = window + 1;
  for (const s of scenes) {
    const d = Math.abs(s - t);
    if (d <= window && d < bestDist) { best = s; bestDist = d; }
  }
  // Or prefer the END of a silence (so we start speech, not silence)
  for (const sil of silences) {
    const d = Math.abs(sil.end - t);
    if (d <= window && d < bestDist) { best = sil.end; bestDist = d; }
  }
  return best;
}

function round(n) { return Math.round(n * 100) / 100; }
