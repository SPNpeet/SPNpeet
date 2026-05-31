/**
 * Synthesize transition / impact sound effects entirely in ffmpeg.
 * Produces an MP3 file ready to be mixed onto the master audio track.
 *
 * Cinematic whoosh: bandpassed noise + bass impact, ducked envelope.
 */

import { spawn } from "node:child_process";

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg sfx failed: ${err.slice(-200)}`))));
  });
}

/**
 * Build a single whoosh — bandpassed pink noise with rapid amp envelope
 * sweeping through 200-3000 Hz, plus a sub-bass thump at the impact.
 */
export async function makeWhoosh(outPath, { duration = 0.45 } = {}) {
  // Filter graph:
  //  1) anoisesrc — pink noise base
  //  2) bandpass sweeping from 300→2500 Hz via afftfilt would be complex,
  //     so we apply a static bandpass with high resonance for cinematic feel
  //  3) volume envelope — sharp attack, exponential decay
  //  4) layer with a sub-bass impact (sine 60Hz with quick decay)
  const tail = Math.max(duration, 0.3).toFixed(3);
  const fc   = "afade=t=in:st=0:d=0.04,afade=t=out:st=0.08:d=" + (Number(tail) - 0.08).toFixed(3);

  const filter = [
    // input 0 = pink noise
    `[0:a]bandpass=f=1200:width_type=h:width=2000,${fc},volume=1.5[whoosh]`,
    // input 1 = sub thump
    `[1:a]volume=2.0,afade=t=in:st=0:d=0.005,afade=t=out:st=0.05:d=0.2[thump]`,
    // mix
    `[whoosh][thump]amix=inputs=2:duration=longest:normalize=0,acompressor=threshold=-15dB:ratio=4:attack=5:release=80[mix]`,
  ].join(";");

  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.6:duration=${tail}`,
    "-f", "lavfi", "-i", `sine=frequency=60:duration=${tail}`,
    "-filter_complex", filter,
    "-map", "[mix]",
    "-ac", "2", "-ar", "44100",
    "-c:a", "pcm_s16le",
    outPath,
  ]);
  return outPath;
}

/**
 * Build a short impact / "boom" hit — sub thump + click attack.
 * Use it on hook reveals.
 */
export async function makeImpact(outPath, { duration = 0.6 } = {}) {
  const tail = duration.toFixed(3);
  const filter = [
    `[0:a]volume=2.5,afade=t=out:st=0.04:d=${(Number(tail) - 0.04).toFixed(3)}[sub]`,
    `[1:a]bandpass=f=2500:width_type=h:width=1500,volume=1.0,afade=t=out:st=0.02:d=0.15[click]`,
    `[sub][click]amix=inputs=2:duration=longest:normalize=0[mix]`,
  ].join(";");

  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `sine=frequency=55:duration=${tail}`,
    "-f", "lavfi", "-i", `anoisesrc=color=white:amplitude=0.4:duration=0.2`,
    "-filter_complex", filter,
    "-map", "[mix]",
    "-ac", "2", "-ar", "44100",
    "-c:a", "pcm_s16le",
    outPath,
  ]);
  return outPath;
}
