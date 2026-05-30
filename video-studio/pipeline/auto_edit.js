/**
 * Auto-edit pipeline
 * Long video → trimmed, graded, ready-to-post MP4
 *
 * Stages:
 *  1. Probe source metadata
 *  2. Distribute segments evenly (smart start/mid/end coverage)
 *  3. Build ffmpeg filter_complex (trim + crop + color-grade + grain + fade per segment)
 *  4. Concat all segments
 *  5. Burn hook / caption / CTA text overlays
 *  6. Normalize + EQ audio
 *  7. Encode H.264 / AAC, faststart
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const MAX_SEGMENTS = 14;
const MIN_SEG = 12;   // seconds — minimum segment duration
const MAX_SEG = 30;   // seconds — maximum segment duration

export const FORMAT_SPEC = {
  vertical:  { w: 1080, h: 1920, label: "TikTok / IG Reels (9:16)" },
  landscape: { w: 1920, h: 1080, label: "YouTube / Wide (16:9)" },
};

// ─── Probe ───────────────────────────────────────────────────────────────────

async function probeVideo(src) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      ["-v", "quiet", "-of", "json", "-show_streams", "-show_format", src],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0) return reject(new Error("ffprobe failed"));
      try {
        const d = JSON.parse(out);
        const v = d.streams?.find((s) => s.codec_type === "video");
        const a = d.streams?.find((s) => s.codec_type === "audio");
        const [num, den] = (v?.r_frame_rate || "30/1").split("/");
        resolve({
          duration: parseFloat(d.format?.duration || 0),
          width:    parseInt(v?.width  || 1920),
          height:   parseInt(v?.height || 1080),
          fps:      parseFloat(num) / parseFloat(den || 1),
          hasAudio: !!a,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ─── Segment selection ────────────────────────────────────────────────────────

function buildSegments(sourceDuration, targetDuration) {
  if (sourceDuration <= targetDuration + 5) {
    // Source is short enough — use it all
    return [{ start: 0, end: sourceDuration }];
  }

  const segCount = Math.min(
    MAX_SEGMENTS,
    Math.max(2, Math.ceil(targetDuration / MAX_SEG))
  );
  const segDur = Math.min(MAX_SEG, Math.max(MIN_SEG, targetDuration / segCount));
  const usable = sourceDuration * 0.93; // avoid trailing fade-out

  // Spread segment start-points evenly across the source
  const gap = (usable - segDur * segCount) / Math.max(segCount - 1, 1);
  const segs = [];
  for (let i = 0; i < segCount; i++) {
    const start = parseFloat((i * (segDur + gap)).toFixed(2));
    const end   = parseFloat((start + segDur).toFixed(2));
    if (end > sourceDuration) break;
    segs.push({ start, end });
  }
  return segs;
}

// ─── Filter builders ─────────────────────────────────────────────────────────

function cropFilter(fmt, srcW, srcH) {
  if (fmt === "vertical") {
    // Centre-crop to 9:16 pillar
    const cropW = Math.min(Math.floor(srcH * 9 / 16), srcW);
    const x     = Math.floor((srcW - cropW) / 2);
    return `crop=${cropW}:${srcH}:${x}:0`;
  } else {
    // Centre-crop to 16:9 letterbox (only when source is taller than 16:9)
    const srcAR    = srcW / srcH;
    const targetAR = 16 / 9;
    if (srcAR < targetAR - 0.05) {
      const cropH = Math.floor(srcW / targetAR);
      const y     = Math.floor((srcH - cropH) / 2);
      return `crop=${srcW}:${cropH}:0:${y}`;
    }
    return null; // No crop needed
  }
}

function colorGrade() {
  return [
    "eq=gamma=0.92:saturation=1.22:contrast=1.08:brightness=-0.02",
    "unsharp=5:5:0.35:3:3:0",
    "noise=alls=6:allf=t+u",   // light film grain
    "vignette=angle=PI/4.5",
  ].join(",");
}

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g,  "\\'")
    .replace(/:/g,  "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function textOverlayFilters(fmt, totalDur, hookText, caption, ctaText) {
  const isV = fmt === "vertical";
  const overlays = [];

  const addText = (text, size, yExpr, tStart, tEnd) => {
    if (!text?.trim()) return;
    const escaped = escapeDrawtext(text);
    overlays.push(
      [
        `drawtext=fontfile='${FONT}'`,
        `text='${escaped}'`,
        `fontsize=${size}`,
        `fontcolor=white`,
        `x=(w-text_w)/2`,
        `y=${yExpr}`,
        `box=1`,
        `boxcolor=black@0.60`,
        `boxborderw=22`,
        `enable='between(t,${tStart.toFixed(2)},${tEnd.toFixed(2)})'`,
      ].join(":")
    );
  };

  // Hook — first 3.5 s
  addText(hookText, isV ? 88 : 68,  isV ? "h/5"             : "h/4",  0.7, 3.8);

  // Mid caption — 25%–55% of clip
  addText(caption,  isV ? 54 : 44,  isV ? "(h-text_h)/2"    : "h*3/4-text_h",
          totalDur * 0.25, totalDur * 0.55);

  // CTA — last 5 seconds
  addText(ctaText,  isV ? 82 : 62,  isV ? "h*2/5-text_h/2"  : "h/2-text_h/2",
          Math.max(0, totalDur - 5.2), Math.max(0, totalDur - 0.4));

  return overlays.join(",");
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * @param {string}   src             Source video path
 * @param {string}   outputPath      Destination MP4 path
 * @param {object}   options
 * @param {function} onProgress      ({ stage, progress 0-100, log? }) => void
 */
export async function autoEdit(src, outputPath, options = {}, onProgress = () => {}) {
  const {
    format         = "vertical",
    targetDuration = 180,  // 3 min default
    hookText       = "",
    caption        = "",
    ctaText        = "",
  } = options;

  // 1. Probe
  onProgress({ stage: "Probing source video…", progress: 2 });
  const meta = await probeVideo(src);
  onProgress({ stage: `Source: ${meta.duration.toFixed(1)}s · ${meta.width}×${meta.height}`, progress: 5 });

  // 2. Segments
  const segs  = buildSegments(meta.duration, targetDuration);
  const n     = segs.length;
  const totalOut = segs.reduce((s, seg) => s + seg.end - seg.start, 0);
  onProgress({ stage: `Selecting ${n} segment${n > 1 ? "s" : ""} → ~${Math.round(totalOut)}s output`, progress: 8 });

  const spec   = FORMAT_SPEC[format] || FORMAT_SPEC.vertical;
  const crop   = cropFilter(format, meta.width, meta.height);
  const grade  = colorGrade();

  // 3. Build filter_complex
  const parts  = [];
  const vTags  = [];
  const aTags  = [];

  for (let i = 0; i < n; i++) {
    const { start, end } = segs[i];
    const segDur = end - start;

    // Video chain for segment i
    const vChain = [];
    vChain.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS`);
    if (crop) vChain.push(crop);
    vChain.push(`scale=${spec.w}:${spec.h}:flags=lanczos,setsar=1`);
    vChain.push(grade);
    if (i === 0)     vChain.push(`fade=t=in:st=0:d=0.5`);
    if (i === n - 1) vChain.push(`fade=t=out:st=${Math.max(0, segDur - 0.7)}:d=0.7`);

    parts.push(`${vChain.join(",")}[v${i}]`);
    vTags.push(`[v${i}]`);

    // Audio chain for segment i
    if (meta.hasAudio) {
      const aChain = [];
      aChain.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`);
      aChain.push(`afade=t=in:st=0:d=0.35`);
      aChain.push(`afade=t=out:st=${Math.max(0, segDur - 0.5)}:d=0.5`);
      parts.push(`${aChain.join(",")}[a${i}]`);
      aTags.push(`[a${i}]`);
    }
  }

  // Concat video
  const vConcatTag = textOverlayFilters(format, totalOut, hookText, caption, ctaText)
    ? "[vconcated]"
    : "[vfinal]";
  parts.push(`${vTags.join("")}concat=n=${n}:v=1:a=0${vConcatTag}`);

  // Text overlays
  const overlays = textOverlayFilters(format, totalOut, hookText, caption, ctaText);
  if (overlays) {
    parts.push(`[vconcated]${overlays}[vfinal]`);
  }

  // Concat + process audio
  if (meta.hasAudio && aTags.length > 0) {
    parts.push(`${aTags.join("")}concat=n=${aTags.length}:v=0:a=1[aconcated]`);
    parts.push(
      "[aconcated]" +
      "dynaudnorm=p=0.95:m=100," +
      "equalizer=f=80:width_type=o:width=2:g=3," +
      "equalizer=f=3000:width_type=o:width=1:g=1.5" +
      "[afinal]"
    );
  }

  const filterScript = parts.join(";\n");
  const filterFile   = path.join(tmpdir(), `ae_filter_${randomUUID()}.txt`);
  await fs.writeFile(filterFile, filterScript);
  onProgress({ stage: "Filter graph ready, starting encode…", progress: 12 });

  // 4. Build ffmpeg args
  const args = [
    "-y",
    "-i", src,
    "-filter_complex_script", filterFile,
    "-map", "[vfinal]",
  ];

  if (meta.hasAudio && aTags.length > 0) {
    args.push("-map", "[afinal]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100");
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",    "libx264",
    "-crf",    "18",
    "-preset", "fast",
    "-pix_fmt","yuv420p",
    "-movflags","+faststart",
    outputPath
  );

  // 5. Run encode with progress
  const estFrames = Math.ceil(totalOut * (meta.fps || 30));

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let errLog = "";

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      errLog += text;

      const m = /frame=\s*(\d+)/.exec(text);
      if (m) {
        const pct = Math.min(95, 12 + Math.floor((parseInt(m[1]) / estFrames) * 83));
        onProgress({ stage: "Encoding…", progress: pct });
      }
    });

    proc.on("error", reject);
    proc.on("exit", async (code) => {
      await fs.unlink(filterFile).catch(() => {});
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}\n${errLog.slice(-800)}`));
      } else {
        resolve();
      }
    });
  });

  onProgress({ stage: "Done", progress: 100 });
  return { outputPath, segments: n, durationOut: Math.round(totalOut) };
}
