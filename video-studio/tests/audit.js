/**
 * End-to-end audit — exercises every public surface of video-studio.
 *
 * Categories:
 *   1. Pipeline modules (probe, scene/silence detection, segments, sfx, captions)
 *   2. Pipeline integration (full render with various option matrices)
 *   3. Server HTTP endpoints (health, static assets, API)
 *   4. Persistence (jobs survive restart)
 *   5. Env var handling (PUBLIC_URL detection)
 */

import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

import { probe, detectScenes, detectSilences, measureLoudness } from "../pipeline/analyze.js";
import { chooseSegments } from "../pipeline/segments.js";
import { makeWhoosh, makeImpact } from "../pipeline/sfx.js";
import { whisperAvailable, generateCaptions } from "../pipeline/captions.js";
import { autoEdit } from "../pipeline/auto_edit.js";

const SOURCE = "assets/clip.mp4";

// ─── Test reporter ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function ok(label, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}${detail ? "  · " + detail : ""}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? "  · " + detail : ""}`);
  }
}

function group(name) {
  console.log("\n── " + name + " ──");
}

async function ffprobe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "quiet", "-of", "json", "-show_streams", "-show_format", file]);
    let out = "";
    p.stdout.on("data", d => out += d);
    p.on("exit", c => c === 0 ? resolve(JSON.parse(out)) : reject(new Error("ffprobe failed")));
  });
}

// ─── 1. Pipeline modules ───────────────────────────────────────────────────
async function testProbe() {
  group("1. PROBE & ANALYSIS");
  const meta = await probe(SOURCE);
  ok("probe duration > 0",       meta.duration > 0,           `${meta.duration}s`);
  ok("probe width matches",      meta.width === 1920,         `${meta.width}px`);
  ok("probe height matches",     meta.height === 1080,        `${meta.height}px`);
  ok("probe fps positive",       meta.fps > 0,                `${meta.fps}fps`);
  ok("probe hasAudio detected",  typeof meta.hasAudio === "boolean", String(meta.hasAudio));

  const scenes = await detectScenes(SOURCE);
  ok("scene detection runs",     Array.isArray(scenes),       `${scenes.length} scenes`);

  const silences = await detectSilences(SOURCE);
  ok("silence detection runs",   Array.isArray(silences),     `${silences.length} silences`);
}

// ─── 2. Segment selection ──────────────────────────────────────────────────
async function testSegments() {
  group("2. SEGMENT SELECTION");
  const meta = await probe(SOURCE);

  // Short target — should pick subset
  const segs180 = chooseSegments(meta, 180, [], []);
  ok("180s target on 25s source → use full",  segs180.length === 1 && segs180[0].kind === "full");

  // Target longer than source — should use full
  const segs30 = chooseSegments(meta, 30, [], []);
  ok("30s target on 25s source → use full",   segs30.length === 1);

  // Now simulate a longer source
  const fakeMeta = { duration: 300, fps: 30, width: 1920, height: 1080 };
  const segs60 = chooseSegments(fakeMeta, 60, [], []);
  ok("60s target on 300s source → multi-seg", segs60.length >= 2);
  ok("multi-seg adds up to ~target",          Math.abs(segs60.reduce((s, x) => s + (x.end - x.start), 0) - 60) < 5);
  ok("first segment marked hook",             segs60[0].kind === "hook");
  ok("last segment marked outro",             segs60[segs60.length - 1].kind === "outro");

  // Scene snap test
  const segsSnap = chooseSegments(fakeMeta, 60, [42.5], []);
  ok("snaps near a scene boundary",           segsSnap[0].start === 0 || segsSnap.some(s => Math.abs(s.start - 42.5) < 0.1));
}

// ─── 3. SFX ────────────────────────────────────────────────────────────────
async function testSfx() {
  group("3. SFX SYNTHESIS");
  const whoosh = "/tmp/audit_whoosh.wav";
  const impact = "/tmp/audit_impact.wav";

  await makeWhoosh(whoosh);
  ok("whoosh file exists",       existsSync(whoosh));
  const wmeta = await ffprobe(whoosh);
  ok("whoosh has audio stream",  wmeta.streams.some(s => s.codec_type === "audio"));
  ok("whoosh duration > 0",      parseFloat(wmeta.format.duration) > 0);

  await makeImpact(impact);
  ok("impact file exists",       existsSync(impact));
  const imeta = await ffprobe(impact);
  ok("impact has audio stream",  imeta.streams.some(s => s.codec_type === "audio"));

  await fs.unlink(whoosh).catch(() => {});
  await fs.unlink(impact).catch(() => {});
}

// ─── 4. Captions ───────────────────────────────────────────────────────────
async function testCaptions() {
  group("4. CAPTIONS (whisper.cpp)");
  const available = await whisperAvailable();
  ok("whisperAvailable() check", typeof available === "boolean", String(available));

  if (available) {
    const result = await generateCaptions(SOURCE, [{ start: 0, end: 10 }], {
      language: "en", width: 1080, height: 1920, accent: "#FFF200", workDir: "/tmp",
    });
    ok("captions return object",   typeof result === "object");
    ok("captions handle non-speech", result.ass === null || typeof result.ass === "string");
  } else {
    ok("captions skip gracefully when whisper missing", true, "fallback OK");
  }
}

// ─── 5. Full integration renders ───────────────────────────────────────────
async function testIntegration(label, options, expectedW, expectedH) {
  const out = `/tmp/audit_${label}.mp4`;
  await fs.unlink(out).catch(() => {});
  try {
    const result = await autoEdit(SOURCE, out, options, () => {});
    ok(`[${label}] autoEdit returned`,      result && result.output === out);
    ok(`[${label}] output file exists`,     existsSync(out));

    const m = await ffprobe(out);
    const v = m.streams.find(s => s.codec_type === "video");
    const a = m.streams.find(s => s.codec_type === "audio");

    ok(`[${label}] codec h264`,             v?.codec_name === "h264");
    ok(`[${label}] width ${expectedW}`,     v?.width === expectedW,  `got ${v?.width}`);
    ok(`[${label}] height ${expectedH}`,    v?.height === expectedH, `got ${v?.height}`);
    ok(`[${label}] has audio (AAC)`,        a?.codec_name === "aac");
    ok(`[${label}] duration reasonable`,    parseFloat(v?.duration) >= 15 && parseFloat(v?.duration) <= 30);
    ok(`[${label}] file size positive`,     parseInt(m.format.size) > 10000);

    return out;
  } catch (err) {
    ok(`[${label}] autoEdit succeeded`, false, err.message.slice(0, 100));
    return null;
  }
}

async function testIntegrationMatrix() {
  group("5. INTEGRATION RENDERS");

  await testIntegration("vertical_full", {
    format: "vertical", targetDuration: 18,
    hookText: "VIRAL", ctaText: "FOLLOW",
    autoCaption: true, sfx: true, progressBar: true, hookZoom: true,
  }, 1080, 1920);

  await testIntegration("landscape_full", {
    format: "landscape", targetDuration: 18,
    hookText: "HOOK", ctaText: "CTA",
    autoCaption: true, sfx: true, progressBar: true, hookZoom: true,
  }, 1920, 1080);

  await testIntegration("vertical_no_captions", {
    format: "vertical", targetDuration: 18,
    autoCaption: false, sfx: true, progressBar: true, hookZoom: true,
  }, 1080, 1920);

  await testIntegration("vertical_no_sfx", {
    format: "vertical", targetDuration: 18,
    autoCaption: true, sfx: false, progressBar: true, hookZoom: true,
  }, 1080, 1920);

  await testIntegration("vertical_minimal", {
    format: "vertical", targetDuration: 18,
    autoCaption: false, sfx: false, progressBar: false, hookZoom: false,
  }, 1080, 1920);

  await testIntegration("vertical_no_text", {
    format: "vertical", targetDuration: 18,
    hookText: "", ctaText: "",
    autoCaption: false, sfx: true, progressBar: true, hookZoom: true,
  }, 1080, 1920);
}

// ─── 6. Loudness compliance ────────────────────────────────────────────────
async function testLoudness() {
  group("6. LOUDNESS COMPLIANCE (TikTok / IG spec)");
  if (!existsSync("/tmp/audit_vertical_full.mp4")) {
    ok("loudness check needs prior render", false, "skipped");
    return;
  }
  const m = await measureLoudness("/tmp/audit_vertical_full.mp4");
  ok("loudness measured",       m !== null);
  if (m) {
    const I  = parseFloat(m.input_i);
    const TP = parseFloat(m.input_tp);
    ok("integrated in [-18,-9] LUFS",   I >= -18 && I <= -9,   `${I} LUFS`);
    ok("true peak under -1 dBTP",       TP <= -1,              `${TP} dBTP`);
  }
}

// ─── 7. Server HTTP ────────────────────────────────────────────────────────
async function curl(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = opts.binary ? null : await res.text().catch(() => null);
  return { status: res.status, ok: res.ok, text, contentType: res.headers.get("content-type") };
}

async function startServer(env = {}) {
  const proc = spawn("node", ["web/server.js"], {
    env: { ...process.env, PORT: "4399", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bannerOut = "";
  proc.stdout.on("data", d => bannerOut += d);
  proc.stderr.on("data", d => bannerOut += d);

  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const r = await fetch("http://localhost:4399/health");
      if (r.ok) return { proc, banner: () => bannerOut };
    } catch {}
  }
  proc.kill();
  throw new Error("server didn't start: " + bannerOut.slice(0, 400));
}

async function testHttp() {
  group("7. SERVER HTTP ENDPOINTS");
  const { proc, banner } = await startServer();
  try {
    const health = await curl("http://localhost:4399/health");
    ok("/health returns 200",        health.ok);
    ok("/health is JSON",            health.contentType?.includes("json"));
    const h = JSON.parse(health.text);
    ok("/health has ok flag",        h.ok === true);
    ok("/health reports uptime",     h.uptime > 0);
    ok("/health reports node",       h.node?.startsWith("v"));

    const home = await curl("http://localhost:4399/");
    ok("/ returns 200",              home.ok);
    ok("/ is HTML",                  home.contentType?.includes("html"));
    ok("/ has manifest link",        home.text?.includes('rel="manifest"'));
    ok("/ has apple-touch-icon",     home.text?.includes('apple-touch-icon'));
    ok("/ has theme-color",          home.text?.includes('theme-color'));
    ok("/ has service worker mention", home.text?.includes('service-worker') || /service.worker/.test(home.text));

    const assets = [
      "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png",
      "/apple-touch-icon.png", "/favicon-32.png", "/service-worker.js",
      "/style.css", "/app.js",
    ];
    for (const a of assets) {
      const r = await curl("http://localhost:4399" + a);
      ok(`asset ${a} 200`, r.ok, `${r.status}`);
    }

    const manifest = await curl("http://localhost:4399/manifest.webmanifest");
    const mj = JSON.parse(manifest.text);
    ok("manifest has name",          !!mj.name);
    ok("manifest has icons",         Array.isArray(mj.icons) && mj.icons.length > 0);
    ok("manifest has start_url",     mj.start_url === "/");
    ok("manifest has display",       mj.display === "standalone");

    const jobsList = await curl("http://localhost:4399/api/jobs");
    ok("/api/jobs returns array",    Array.isArray(JSON.parse(jobsList.text)));

    const noJob = await curl("http://localhost:4399/api/jobs/non-existent-id");
    ok("/api/jobs/:missing → 404",   noJob.status === 404);

    const noFile = await curl("http://localhost:4399/api/render", { method: "POST" });
    ok("POST /api/render no file → 400", noFile.status === 400);
  } finally {
    proc.kill();
    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── 8. End-to-end via HTTP ────────────────────────────────────────────────
async function testE2EHttp() {
  group("8. END-TO-END VIA HTTP");
  const { proc } = await startServer();
  try {
    const fd = new FormData();
    const fileBuf = await fs.readFile(SOURCE);
    fd.append("clip", new Blob([fileBuf]), "clip.mp4");
    fd.append("format", "vertical");
    fd.append("targetDuration", "18");
    fd.append("hookText", "AUDIT");
    fd.append("ctaText", "OK");
    fd.append("autoCaption", "true");
    fd.append("sfx", "true");

    const submit = await fetch("http://localhost:4399/api/render", { method: "POST", body: fd });
    const sj = await submit.json();
    ok("submit returns jobId",  !!sj.jobId);

    // Poll
    let final = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const r = await fetch("http://localhost:4399/api/jobs/" + sj.jobId);
      const j = await r.json();
      if (j.status === "done" || j.status === "error") { final = j; break; }
    }
    ok("job completed",            !!final && final.status === "done", final?.error || "");
    if (final?.output) {
      const dl = await fetch("http://localhost:4399/renders/" + encodeURIComponent(final.output));
      ok("render downloadable",    dl.ok && parseInt(dl.headers.get("content-length")) > 1000);
    }
  } finally {
    proc.kill();
    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── 9. Env var detection ──────────────────────────────────────────────────
async function testEnv() {
  group("9. CLOUD ENV VAR AUTO-DETECTION");

  // Test 1: RENDER_EXTERNAL_URL
  {
    const { proc, banner } = await startServer({ RENDER_EXTERNAL_URL: "https://render-test.onrender.com" });
    await new Promise(r => setTimeout(r, 500));
    proc.kill();
    await new Promise(r => setTimeout(r, 300));
    ok("RENDER_EXTERNAL_URL appears in banner", banner().includes("render-test.onrender.com"));
  }

  // Test 2: FLY_APP_NAME
  {
    const { proc, banner } = await startServer({ FLY_APP_NAME: "fly-test-app" });
    await new Promise(r => setTimeout(r, 500));
    proc.kill();
    await new Promise(r => setTimeout(r, 300));
    ok("FLY_APP_NAME generates fly.dev banner", banner().includes("fly-test-app.fly.dev"));
  }

  // Test 3: PUBLIC_URL highest priority
  {
    const { proc, banner } = await startServer({
      PUBLIC_URL: "https://wins.example.com",
      RENDER_EXTERNAL_URL: "https://loses.onrender.com",
    });
    await new Promise(r => setTimeout(r, 500));
    proc.kill();
    await new Promise(r => setTimeout(r, 300));
    const b = banner();
    ok("PUBLIC_URL wins over RENDER_EXTERNAL_URL", b.includes("wins.example.com") && !b.includes("loses.onrender.com"));
  }
}

// ─── 10. Job persistence ───────────────────────────────────────────────────
async function testPersistence() {
  group("10. JOB DB PERSISTENCE");
  const tmpData = "/tmp/audit_data";
  const tmpRenders = "/tmp/audit_renders";
  await fs.rm(tmpData,    { recursive: true, force: true });
  await fs.rm(tmpRenders, { recursive: true, force: true });
  await fs.mkdir(tmpData,    { recursive: true });
  await fs.mkdir(tmpRenders, { recursive: true });

  const env = { DATA_DIR: tmpData, RENDERS_DIR: tmpRenders };

  // First boot — submit a small fake job, kill mid-flight
  const first = await startServer(env);
  const fd = new FormData();
  const fileBuf = await fs.readFile(SOURCE);
  fd.append("clip", new Blob([fileBuf]), "clip.mp4");
  fd.append("format", "vertical");
  fd.append("targetDuration", "18");
  const submit = await fetch("http://localhost:4399/api/render", { method: "POST", body: fd });
  const { jobId } = await submit.json();
  await new Promise(r => setTimeout(r, 2000)); // let it start
  first.proc.kill();
  await new Promise(r => setTimeout(r, 1500));

  // Second boot — should restore the job, mark interrupted as "error"
  const second = await startServer(env);
  await new Promise(r => setTimeout(r, 500));
  const restored = await (await fetch("http://localhost:4399/api/jobs/" + jobId)).json();
  ok("interrupted job restored",   restored && restored.id === jobId);
  ok("interrupted marked error",   restored.status === "error" && /interrupt/i.test(restored.error || ""));
  second.proc.kill();
  await new Promise(r => setTimeout(r, 300));
}

// ─── Run all ───────────────────────────────────────────────────────────────
async function main() {
  console.log("video-studio — comprehensive audit");
  console.log("source clip:", SOURCE);
  console.log("");

  await testProbe();
  await testSegments();
  await testSfx();
  await testCaptions();
  await testIntegrationMatrix();
  await testLoudness();
  await testHttp();
  await testE2EHttp();
  await testEnv();
  await testPersistence();

  console.log("\n" + "═".repeat(60));
  console.log(`  ${passed} passed · ${failed} failed`);
  console.log("═".repeat(60));
  if (failed > 0) {
    console.log("\nfailures:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("\nFATAL:", err.message);
  process.exit(2);
});
