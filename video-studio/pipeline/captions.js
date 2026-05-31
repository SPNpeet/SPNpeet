/**
 * Auto-captions — runs whisper.cpp on a 16kHz mono PCM extraction of the
 * source audio, then converts the JSON output into an ASS subtitle file
 * with CapCut-style word-by-word karaoke highlight.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WHISPER_DIR = path.resolve(__dirname, "..", "vendor", "whisper");
const WHISPER_BIN = path.join(WHISPER_DIR, "whisper-cli");
const WHISPER_MODEL = path.join(WHISPER_DIR, "ggml-base.bin");

export async function whisperAvailable() {
  try {
    await fs.access(WHISPER_BIN);
    await fs.access(WHISPER_MODEL);
    return true;
  } catch {
    return false;
  }
}

/* ─── Extract mono 16kHz wav for whisper ──────────────────────────────────── */

async function extractAudio(src, dest, { start = 0, duration } = {}) {
  const args = ["-y"];
  if (start) args.push("-ss", String(start));
  args.push("-i", src);
  if (duration) args.push("-t", String(duration));
  args.push("-ac", "1", "-ar", "16000", "-vn", dest);

  await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg audio extract failed: ${err.slice(-200)}`))));
  });
}

/* ─── Run whisper-cli, return word-level segments ────────────────────────── */

async function runWhisper(wavPath, language = "auto") {
  const baseOut = wavPath.replace(/\.wav$/, "");

  const args = [
    "-m", WHISPER_MODEL,
    "-f", wavPath,
    "-ml", "1",
    "-oj",
    "--output-file", baseOut,
    "--threads", String(Math.min(4, cpus().length)),
  ];
  if (language && language !== "auto") args.push("-l", language);

  await new Promise((resolve, reject) => {
    const p = spawn(WHISPER_BIN, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, LD_LIBRARY_PATH: `${WHISPER_DIR}:${process.env.LD_LIBRARY_PATH || ""}` },
    });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`whisper-cli failed: ${err.slice(-200)}`))));
  });

  const jsonPath = `${baseOut}.json`;
  const raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  await fs.unlink(jsonPath).catch(() => {});

  // tsParse maps "HH:MM:SS,mmm" → seconds
  const tsParse = (ts) => {
    const [hms, ms] = ts.split(",");
    const [h, m, s] = hms.split(":").map(Number);
    return h * 3600 + m * 60 + s + Number(ms) / 1000;
  };

  return (raw.transcription || [])
    .map((seg) => ({
      from: tsParse(seg.timestamps.from),
      to:   tsParse(seg.timestamps.to),
      text: (seg.text || "").trim(),
    }))
    .filter((seg) => seg.text);
}

/* ─── Group word-level tokens into 2-4 word phrases for kinetic display ──── */

function groupPhrases(words, { wordsPerPhrase = 3, maxGap = 0.4 } = {}) {
  const phrases = [];
  let cur = null;
  for (const w of words) {
    if (!cur || cur.words.length >= wordsPerPhrase || w.from - cur.to > maxGap) {
      if (cur) phrases.push(cur);
      cur = { from: w.from, to: w.to, words: [w] };
    } else {
      cur.words.push(w);
      cur.to = w.to;
    }
  }
  if (cur) phrases.push(cur);
  return phrases;
}

/* ─── ASS subtitle generation with karaoke kinetic effect ────────────────── */

const ASS_HEADER = (width, height) => `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,${Math.round(height * 0.05)},&H00FFFFFF,&H0000F2FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,3,2,80,80,${Math.round(height * 0.18)},0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

function fmtAssTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(s) {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

/**
 * Build CapCut/Submagic-style word highlight subtitle.
 * Each phrase line shows all words white, but the currently-spoken word
 * pops with yellow accent and a tiny scale, syncing to the timestamps.
 */
export function phrasesToAss(phrases, { width = 1080, height = 1920, accent = "FFF200", offset = 0 } = {}) {
  const lines = [];
  const accBgr = accent.match(/^#?([0-9a-fA-F]{6})$/);
  // Convert #RRGGBB → ASS &HBBGGRR& (no alpha)
  let accentAss = "&H0000F2FF&"; // default yellow-ish
  if (accBgr) {
    const r = accBgr[1].slice(0, 2);
    const g = accBgr[1].slice(2, 4);
    const b = accBgr[1].slice(4, 6);
    accentAss = `&H00${b}${g}${r}&`;
  }

  for (const ph of phrases) {
    const phraseStart = Math.max(0, ph.from - offset);
    const phraseEnd   = Math.max(phraseStart + 0.1, ph.to - offset + 0.15);

    // Whole phrase, with active word swapped using \r override at word boundaries.
    // Strategy: emit one ASS line per word, showing the full phrase with
    // current word highlighted via colour + slight scale.
    for (let i = 0; i < ph.words.length; i++) {
      const w     = ph.words[i];
      const start = Math.max(phraseStart, w.from - offset);
      const end   = i === ph.words.length - 1 ? phraseEnd : Math.max(start + 0.05, ph.words[i + 1].from - offset);

      const parts = ph.words.map((ww, j) => {
        const word = escapeAssText(ww.text.trim());
        if (j === i) {
          return `{\\c${accentAss}\\fscx115\\fscy115\\bord5}${word}{\\r}`;
        }
        return `{\\c&H00FFFFFF&\\fscx100\\fscy100}${word}`;
      });
      const text = parts.join(" ");
      // Pop-in fade for the active word
      const fade = i === 0 ? "{\\fad(120,0)}" : "";
      lines.push(`Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Default,,0,0,0,,${fade}${text}`);
    }
  }
  return ASS_HEADER(width, height) + lines.join("\n") + "\n";
}

/* ─── Public API ──────────────────────────────────────────────────────────── */

/**
 * Generate ASS subtitle file for the given source segments.
 *
 * @param {string} src              Source video path
 * @param {array}  segments         [{ start, end }] in source-time
 * @param {object} options          { language, width, height, accent, workDir }
 * @returns {Promise<{ ass: string, phraseCount: number }>}
 */
export async function generateCaptions(src, segments, options = {}) {
  const {
    language = "auto",
    width = 1080,
    height = 1920,
    accent = "#FFF200",
    workDir = "/tmp",
  } = options;

  if (!(await whisperAvailable())) {
    return { ass: null, phraseCount: 0, reason: "whisper-not-installed" };
  }

  const allPhrases = [];

  // Per-segment: extract audio, run whisper, offset to output timeline
  let outputOffset = 0;
  for (const seg of segments) {
    const segDur = seg.end - seg.start;
    const wavPath = path.join(workDir, `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
    try {
      await extractAudio(src, wavPath, { start: seg.start, duration: segDur });
      const words = await runWhisper(wavPath, language);
      // Shift word timestamps from segment-local time to output-timeline time
      const shifted = words.map((w) => ({
        from: w.from + outputOffset,
        to:   w.to   + outputOffset,
        text: w.text,
      }));
      allPhrases.push(...groupPhrases(shifted));
    } finally {
      await fs.unlink(wavPath).catch(() => {});
    }
    outputOffset += segDur;
  }

  if (allPhrases.length === 0) {
    return { ass: null, phraseCount: 0, reason: "no-speech-detected" };
  }

  const ass = phrasesToAss(allPhrases, { width, height, accent });
  return { ass, phraseCount: allPhrases.length };
}
