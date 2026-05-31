/**
 * Auto-edit pipeline v2 — "viral-ready" output.
 *
 *  Source clip (any length) →
 *    • Probe + scene + silence detection
 *    • Smart segment selection snapped to scene boundaries
 *    • Per-segment: trim → smart crop → scale → color grade
 *      → film grain + vignette → punch-in zoom for hook
 *    • Concat with eased fades
 *    • Auto captions (whisper.cpp) with kinetic word-by-word
 *      karaoke highlight (CapCut/Submagic style)
 *    • Hook + CTA drawtext overlays positioned outside caption zone
 *    • Animated progress bar at bottom
 *    • Whoosh SFX on every transition + impact hit on hook
 *    • Audio: dynaudnorm + EQ + loudnorm to -14 LUFS / -1.5 dBTP
 *    • H.264 high-profile, CRF 18, AAC 192k, faststart
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { probe, detectSilences, detectScenes } from "./analyze.js";
import { chooseSegments } from "./segments.js";
import { generateCaptions, whisperAvailable } from "./captions.js";
import { makeWhoosh, makeImpact } from "./sfx.js";

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

export const FORMAT_SPEC = {
  vertical:  { w: 1080, h: 1920, label: "TikTok / IG Reels (9:16)" },
  landscape: { w: 1920, h: 1080, label: "YouTube / Wide (16:9)" },
};

/* ─── Filter builders ─────────────────────────────────────────────────────── */

function cropFilter(format, srcW, srcH) {
  if (format === "vertical") {
    const cropW = Math.min(Math.floor(srcH * 9 / 16), srcW);
    const x     = Math.floor((srcW - cropW) / 2);
    return `crop=${cropW}:${srcH}:${x}:0`;
  }
  // landscape: only crop if source is squarer than 16:9
  const srcAR    = srcW / srcH;
  const targetAR = 16 / 9;
  if (srcAR < targetAR - 0.05) {
    const cropH = Math.floor(srcW / targetAR);
    const y     = Math.floor((srcH - cropH) / 2);
    return `crop=${srcW}:${cropH}:0:${y}`;
  }
  return null;
}

function colorGrade() {
  return [
    "eq=gamma=0.94:saturation=1.20:contrast=1.07:brightness=-0.015",
    "unsharp=5:5:0.3:3:3:0",
    "noise=alls=5:allf=t+u",
    "vignette=angle=PI/4.5",
  ].join(",");
}

function escapeDrawtext(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g,  "\\\\'")
    .replace(/:/g,  "\\\\:")
    .replace(/%/g,  "\\\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Hook (first 4s) + CTA (last 5s) text — large bold w/ box, positioned in the
 * upper-third so it doesn't collide with bottom captions.
 */
function textOverlayFilters(format, totalDur, { hookText, ctaText, accent }) {
  const overlays = [];
  const isV   = format === "vertical";
  const baseY = isV ? "h/4" : "h/5";

  const accentBgr = (accent || "#FFF200").replace("#", "");
  const accentHex = `0x${accentBgr}`;

  const addText = (text, opts) => {
    if (!text || !text.trim()) return;
    const t = escapeDrawtext(text.toUpperCase());
    const parts = [
      `drawtext=fontfile='${FONT}'`,
      `text='${t}'`,
      `fontsize=${opts.size}`,
      `fontcolor=${opts.color || "white"}`,
      `x=(w-text_w)/2`,
      `y=${opts.y}`,
      `box=1`,
      `boxcolor=black@0.78`,
      `boxborderw=24`,
      `borderw=4`,
      `bordercolor=${accentHex}@0.9`,
      `shadowx=0:shadowy=4`,
      `shadowcolor=black@0.6`,
      `alpha='if(lt(t,${opts.in.toFixed(2)}),0,if(lt(t,${(opts.in + 0.25).toFixed(2)}),(t-${opts.in.toFixed(2)})/0.25,if(lt(t,${(opts.out - 0.25).toFixed(2)}),1,if(lt(t,${opts.out.toFixed(2)}),((${opts.out.toFixed(2)}-t)/0.25),0))))'`,
      `enable='between(t,${opts.in.toFixed(2)},${opts.out.toFixed(2)})'`,
    ];
    overlays.push(parts.join(":"));
  };

  if (hookText) {
    addText(hookText, {
      size: isV ? 96 : 76,
      y:    baseY,
      in:   0.15,
      out:  3.8,
    });
  }

  if (ctaText && totalDur > 8) {
    addText(ctaText, {
      size: isV ? 88 : 70,
      y:    isV ? "h/2 - text_h/2" : "h*2/5",
      in:   Math.max(0, totalDur - 5),
      out:  Math.max(0.5, totalDur - 0.3),
    });
  }

  return overlays.join(",");
}

/* ─── Main entry point ────────────────────────────────────────────────────── */

export async function autoEdit(src, output, options = {}, onProgress = () => {}) {
  const {
    format         = "vertical",
    targetDuration = 180,
    hookText       = "",
    ctaText        = "",
    accent         = "#FFF200",
    language       = "auto",
    autoCaption    = true,
    sfx            = true,
    progressBar    = true,
    hookZoom       = true,
  } = options;

  const spec    = FORMAT_SPEC[format] || FORMAT_SPEC.vertical;
  const workDir = path.join("/tmp", `ae_${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    /* ── 1. Probe + analyze in parallel ─────────────────────────────────── */
    onProgress({ stage: "Analyzing source…", progress: 3 });
    const meta = await probe(src);
    if (!meta.duration) throw new Error("Cannot determine source duration");

    onProgress({ stage: `Source: ${meta.duration.toFixed(1)}s · ${meta.width}×${meta.height}`, progress: 5 });

    const [silences, scenes] = await Promise.all([
      detectSilences(src).catch(() => []),
      detectScenes(src, { threshold: 0.35 }).catch(() => []),
    ]);
    onProgress({ stage: `Detected ${scenes.length} scenes, ${silences.length} silences`, progress: 12 });

    /* ── 2. Choose segments ─────────────────────────────────────────────── */
    const segments = chooseSegments(meta, targetDuration, scenes, silences);
    const totalOut = segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
    const segCount = segments.length;
    onProgress({ stage: `Cutting ${segCount} segments → ~${Math.round(totalOut)}s`, progress: 18 });

    /* ── 3. Generate captions + SFX in parallel ─────────────────────────── */
    const tasks = [];

    const captionsPromise = (async () => {
      if (!autoCaption) return { ass: null, phraseCount: 0 };
      if (!(await whisperAvailable())) return { ass: null, phraseCount: 0, reason: "no-whisper" };
      onProgress({ stage: "Auto-transcribing speech…", progress: 22 });
      return await generateCaptions(src, segments, {
        language, width: spec.w, height: spec.h, accent, workDir,
      });
    })();
    tasks.push(captionsPromise);

    const whooshPath = path.join(workDir, "whoosh.wav");
    const impactPath = path.join(workDir, "impact.wav");
    if (sfx) {
      tasks.push(makeWhoosh(whooshPath));
      tasks.push(makeImpact(impactPath));
    }

    const [captions] = await Promise.all(tasks);
    let assPath = null;
    if (captions?.ass) {
      assPath = path.join(workDir, "captions.ass");
      await fs.writeFile(assPath, captions.ass);
      onProgress({ stage: `Captions: ${captions.phraseCount} phrases`, progress: 38 });
    } else {
      onProgress({ stage: captions?.reason === "no-whisper"
        ? "Captions skipped (whisper not installed)"
        : "Captions skipped (no speech)", progress: 38 });
    }

    /* ── 4. Build filter_complex ────────────────────────────────────────── */
    const crop  = cropFilter(format, meta.width, meta.height);
    const grade = colorGrade();
    const parts = [];
    const vTags = [];
    const aTags = [];

    for (let i = 0; i < segCount; i++) {
      const { start, end, kind } = segments[i];
      const dur = end - start;

      // ── Video chain ──
      const v = [`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS`];
      if (crop) v.push(crop);
      v.push(`scale=${spec.w}:${spec.h}:force_original_aspect_ratio=increase:flags=lanczos`);
      v.push(`crop=${spec.w}:${spec.h}`);
      v.push("setsar=1");

      // Punch-in zoom on hook
      if (i === 0 && hookZoom) {
        const fps    = Math.round(meta.fps || 30);
        const frames = Math.max(1, Math.round(dur * fps));
        v.push(
          `zoompan=z='1+0.08*on/${frames}':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=1:s=${spec.w}x${spec.h}:fps=${fps}`
        );
      }

      v.push(grade);

      // Fades on the very first frame of seg 0 and last 0.6s of last segment
      if (i === 0)              v.push(`fade=t=in:st=0:d=0.4`);
      if (i === segCount - 1)   v.push(`fade=t=out:st=${Math.max(0, dur - 0.6)}:d=0.6`);

      parts.push(`${v.join(",")}[v${i}]`);
      vTags.push(`[v${i}]`);

      // ── Audio chain ──
      if (meta.hasAudio) {
        const a = [`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`];
        a.push(`afade=t=in:st=0:d=0.18`);
        a.push(`afade=t=out:st=${Math.max(0, dur - 0.25)}:d=0.25`);
        parts.push(`${a.join(",")}[a${i}]`);
        aTags.push(`[a${i}]`);
      }
    }

    // ── Concat video ──
    parts.push(`${vTags.join("")}concat=n=${segCount}:v=1:a=0[vcat]`);
    let lastV = "[vcat]";

    // ── Progress bar (overlay slides a full-width strip from the left) ──
    if (progressBar) {
      const accentHash = accent || "#FFF200";
      parts.push(
        `color=c=${accentHash}:s=${spec.w}x7:d=${totalOut.toFixed(2)},format=rgba[pbsrc]`
      );
      parts.push(
        `${lastV}[pbsrc]overlay=x='-W*(1-t/${totalOut.toFixed(2)})':y=H-7[vpb]`
      );
      lastV = "[vpb]";
    }

    // ── Hook + CTA text overlays ──
    const textChain = textOverlayFilters(format, totalOut, { hookText, ctaText, accent });
    if (textChain) {
      parts.push(`${lastV}${textChain}[vtext]`);
      lastV = "[vtext]";
    }

    // ── Subtitle burn-in ──
    if (assPath) {
      const safe = assPath.replace(/'/g, "\\'");
      parts.push(`${lastV}subtitles='${safe}'[vsubs]`);
      lastV = "[vsubs]";
    }

    // ── Audio concat + processing + SFX mixing ──
    let audioMapTag = null;
    let extraInputCount = 0;
    const cutTimes = []; // output-timeline timestamps where a transition starts

    if (meta.hasAudio && aTags.length) {
      parts.push(`${aTags.join("")}concat=n=${aTags.length}:v=0:a=1[acat]`);
      parts.push(
        "[acat]" +
        "dynaudnorm=p=0.95:m=20:s=12," +
        "equalizer=f=80:width_type=o:width=2:g=2.5," +
        "equalizer=f=3000:width_type=o:width=1:g=1.5," +
        "loudnorm=I=-14:TP=-1.5:LRA=11" +
        "[aproc]"
      );

      let acc = 0;
      for (let i = 0; i < segCount - 1; i++) {
        acc += segments[i].end - segments[i].start;
        cutTimes.push(acc);
      }

      if (sfx && (cutTimes.length > 0 || true)) {
        // Inputs 1 = whoosh, 2 = impact
        extraInputCount = 2;
        const sfxTags = [];

        // One whoosh per cut, slightly before the transition for momentum
        for (let k = 0; k < cutTimes.length; k++) {
          const tMs = Math.max(0, Math.round((cutTimes[k] - 0.12) * 1000));
          parts.push(`[1:a]adelay=${tMs}|${tMs},volume=0.55[sfx${k}]`);
          sfxTags.push(`[sfx${k}]`);
        }
        // Impact on hook (300ms in)
        parts.push(`[2:a]adelay=280|280,volume=0.5[hookhit]`);
        sfxTags.push(`[hookhit]`);

        if (sfxTags.length > 0) {
          parts.push(`[aproc]${sfxTags.join("")}amix=inputs=${sfxTags.length + 1}:duration=first:normalize=0,alimiter=limit=0.97:level=disabled[afinal]`);
        } else {
          parts.push(`[aproc]alimiter=limit=0.97:level=disabled[afinal]`);
        }
      } else {
        parts.push(`[aproc]alimiter=limit=0.97:level=disabled[afinal]`);
      }
      audioMapTag = "[afinal]";
    }

    /* ── 5. Encode ──────────────────────────────────────────────────────── */
    const filterScript = parts.join(";\n");
    const filterFile   = path.join(workDir, "filter.txt");
    await fs.writeFile(filterFile, filterScript);

    const args = ["-y"];
    args.push("-i", src);
    if (sfx && meta.hasAudio) {
      args.push("-i", whooshPath, "-i", impactPath);
    }
    args.push("-filter_complex_script", filterFile);
    args.push("-map", lastV);
    if (audioMapTag) {
      args.push("-map", audioMapTag, "-c:a", "aac", "-b:a", "192k", "-ar", "44100");
    } else {
      args.push("-an");
    }
    args.push(
      "-c:v",    "libx264",
      "-profile:v", "high",
      "-level",  "4.1",
      "-crf",    "18",
      "-preset", "fast",
      "-pix_fmt","yuv420p",
      "-movflags","+faststart",
      "-r",      "30",
      output
    );

    const estFrames = Math.ceil(totalOut * 30);

    onProgress({ stage: "Rendering final video…", progress: 42 });

    await new Promise((resolve, reject) => {
      const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";

      proc.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        err += text;
        if (err.length > 4000) err = err.slice(-4000);

        const m = /frame=\s*(\d+)/.exec(text);
        if (m) {
          const pct = Math.min(96, 42 + Math.floor((parseInt(m[1]) / estFrames) * 54));
          onProgress({ stage: "Encoding…", progress: pct });
        }
      });

      proc.on("error", reject);
      proc.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ffmpeg exited ${code}\n${err.slice(-1200)}`))
      );
    });

    onProgress({ stage: "Done", progress: 100 });
    return {
      output,
      segments: segCount,
      durationOut: Math.round(totalOut),
      captions:    captions?.phraseCount || 0,
      effects: {
        sfx, hookZoom, progressBar,
        captionsBurned: !!assPath,
      },
    };
  } finally {
    // Clean work dir
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
