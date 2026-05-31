/**
 * Source-clip analysis — silence detection, scene detection, probe.
 * All operations are read-only on the source file.
 */

import { spawn } from "node:child_process";

function runCollect(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
    );
  });
}

/* ─── ffprobe ─────────────────────────────────────────────────────────────── */

export async function probe(src) {
  const { stdout } = await runCollect("ffprobe", [
    "-v", "quiet",
    "-of", "json",
    "-show_streams", "-show_format", src,
  ]);
  const d = JSON.parse(stdout);
  const v = d.streams?.find((s) => s.codec_type === "video");
  const a = d.streams?.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate || "30/1").split("/");
  return {
    duration: parseFloat(d.format?.duration || 0),
    width:    parseInt(v?.width  || 1920),
    height:   parseInt(v?.height || 1080),
    fps:      parseFloat(num) / parseFloat(den || 1),
    hasAudio: !!a,
  };
}

/* ─── silence detection (returns [start, end] tuples in seconds) ──────────── */

export async function detectSilences(src, { noise = -32, dur = 0.45 } = {}) {
  if (!(await probe(src)).hasAudio) return [];
  try {
    const { stderr } = await runCollect("ffmpeg", [
      "-hide_banner", "-i", src,
      "-af", `silencedetect=noise=${noise}dB:d=${dur}`,
      "-f", "null", "-",
    ]);
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
    const ends   = [...stderr.matchAll(/silence_end: ([\d.]+) /g)].map((m) => +m[1]);
    const pairs = [];
    for (let i = 0; i < starts.length; i++) {
      pairs.push({ start: starts[i], end: ends[i] ?? starts[i] + dur });
    }
    return pairs;
  } catch {
    return [];
  }
}

/* ─── scene-change detection (returns timestamps in seconds) ──────────────── */

export async function detectScenes(src, { threshold = 0.35 } = {}) {
  try {
    const { stderr } = await runCollect("ffmpeg", [
      "-hide_banner", "-i", src,
      "-vf", `select='gt(scene,${threshold})',metadata=print:file=-`,
      "-an", "-f", "null", "-",
    ]);
    return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
  } catch {
    return [];
  }
}

/* ─── loudnorm 2-pass — pass 1 measurement ────────────────────────────────── */

export async function measureLoudness(src, { I = -14, TP = -1.5, LRA = 11 } = {}) {
  try {
    const { stderr } = await runCollect("ffmpeg", [
      "-hide_banner", "-i", src,
      "-af", `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`,
      "-f", "null", "-",
    ]);
    const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    return {
      input_i:      j.input_i,
      input_tp:     j.input_tp,
      input_lra:    j.input_lra,
      input_thresh: j.input_thresh,
      target_offset: j.target_offset,
    };
  } catch {
    return null;
  }
}
