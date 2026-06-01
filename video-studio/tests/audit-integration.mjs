import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import { autoEdit } from "../pipeline/auto_edit.js";
import { measureLoudness } from "../pipeline/analyze.js";

const SOURCE = "assets/clip.mp4";
let pass = 0, fail = 0;
const fails = [];
const ok = (label, cond, detail = "") => {
  cond ? pass++ : fail++;
  if (!cond) fails.push(label + (detail ? " (" + detail + ")" : ""));
  console.log((cond ? "  ✓" : "  ✗"), label, detail ? "· " + detail : "");
};

async function ffprobe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "quiet", "-of", "json", "-show_streams", "-show_format", file]);
    let out = "";
    p.stdout.on("data", d => out += d);
    p.on("exit", c => c === 0 ? resolve(JSON.parse(out)) : reject(new Error("ffprobe failed")));
  });
}

async function runCase(label, options, expW, expH) {
  const out = `/tmp/audit_${label}.mp4`;
  await fs.unlink(out).catch(() => {});
  const t0 = Date.now();
  try {
    const result = await autoEdit(SOURCE, out, options, () => {});
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    ok(`[${label}] returned in ${dt}s`, result?.output === out);
    ok(`[${label}] file exists`, existsSync(out));
    const m = await ffprobe(out);
    const v = m.streams.find(s => s.codec_type === "video");
    const a = m.streams.find(s => s.codec_type === "audio");
    ok(`[${label}] codec h264`,     v?.codec_name === "h264");
    ok(`[${label}] ${expW}×${expH}`, v?.width === expW && v?.height === expH, `${v?.width}×${v?.height}`);
    ok(`[${label}] aac audio`,       a?.codec_name === "aac");
    ok(`[${label}] dur 15-30s`,      parseFloat(v?.duration) >= 15 && parseFloat(v?.duration) <= 30, v?.duration + "s");
    ok(`[${label}] size > 50KB`,     parseInt(m.format.size) > 50000, m.format.size + "b");
    return out;
  } catch (err) {
    ok(`[${label}] autoEdit succeeded`, false, err.message.slice(0, 80));
    return null;
  }
}

console.log("── INTEGRATION MATRIX ──");

const opts = (overrides) => ({
  format: "vertical", targetDuration: 18,
  hookText: "TEST", ctaText: "OK", accent: "#FFF200",
  language: "en", autoCaption: true, sfx: true, progressBar: true, hookZoom: true,
  ...overrides,
});

await runCase("vertical_all_on",  opts({}), 1080, 1920);
await runCase("landscape_all_on", opts({ format: "landscape" }), 1920, 1080);
await runCase("no_captions",      opts({ autoCaption: false }), 1080, 1920);
await runCase("no_sfx",           opts({ sfx: false }), 1080, 1920);
await runCase("no_zoom",          opts({ hookZoom: false }), 1080, 1920);
await runCase("no_progress_bar",  opts({ progressBar: false }), 1080, 1920);
await runCase("minimal",          opts({ autoCaption: false, sfx: false, progressBar: false, hookZoom: false }), 1080, 1920);
await runCase("no_text",          opts({ hookText: "", ctaText: "" }), 1080, 1920);

console.log("\n── LOUDNESS COMPLIANCE ──");
if (existsSync("/tmp/audit_vertical_all_on.mp4")) {
  const m = await measureLoudness("/tmp/audit_vertical_all_on.mp4");
  if (m) {
    const I = parseFloat(m.input_i);
    const TP = parseFloat(m.input_tp);
    ok("integrated -18 to -9 LUFS", I >= -18 && I <= -9, I + " LUFS");
    ok("true peak ≤ -1 dBTP",       TP <= -1,            TP + " dBTP");
  } else {
    ok("loudness measurable", false);
  }
}

console.log("\n" + pass + " passed · " + fail + " failed");
if (fails.length) console.log("failures:\n  " + fails.join("\n  "));
process.exit(fail > 0 ? 1 : 0);
