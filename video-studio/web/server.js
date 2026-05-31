import express from "express";
import multer from "multer";
import qrcode from "qrcode";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoEdit } from "../pipeline/auto_edit.js";

/* ─── Paths (env-overridable for cloud volumes) ──────────────────────────── */

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, "..");
const UPLOAD_DIR  = process.env.UPLOAD_DIR  || path.join(ROOT, "assets", "_uploads");
const RENDERS_DIR = process.env.RENDERS_DIR || path.join(ROOT, "renders");
const DATA_DIR    = process.env.DATA_DIR    || path.join(ROOT, "data");
const PUBLIC_DIR  = path.join(__dirname, "public");
const PORT        = Number(process.env.PORT) || 4321;
const PUBLIC_URL  = process.env.PUBLIC_URL  || "";
const JOB_DB_PATH = path.join(DATA_DIR, "jobs.json");

await Promise.all([
  fs.mkdir(UPLOAD_DIR,  { recursive: true }),
  fs.mkdir(RENDERS_DIR, { recursive: true }),
  fs.mkdir(DATA_DIR,    { recursive: true }),
]);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

/* ─── Persistent job store ───────────────────────────────────────────────── */
// Jobs survive restarts; we save after every status change.

const jobs = new Map();
let saveQueued = false;

async function loadJobs() {
  if (!existsSync(JOB_DB_PATH)) return;
  try {
    const raw = await fs.readFile(JOB_DB_PATH, "utf8");
    const data = JSON.parse(raw);
    for (const j of data) {
      // Anything still "running" at boot crashed mid-render — mark as error
      if (j.status === "running" || j.status === "queued") {
        j.status = "error";
        j.error  = "render interrupted (server restart)";
      }
      jobs.set(j.id, j);
    }
    console.log(`[jobs] restored ${jobs.size} job(s) from ${JOB_DB_PATH}`);
  } catch (err) {
    console.warn(`[jobs] failed to read ${JOB_DB_PATH}: ${err.message}`);
  }
}

function saveJobsSoon() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(async () => {
    saveQueued = false;
    try {
      const snapshot = [...jobs.values()].slice(-200); // keep last 200
      await fs.writeFile(JOB_DB_PATH, JSON.stringify(snapshot, null, 2));
    } catch (err) {
      console.warn(`[jobs] save failed: ${err.message}`);
    }
  }, 800);
}

function newJob() {
  const job = {
    id:        randomUUID(),
    status:    "queued",
    progress:  0,
    stage:     "queued",
    log:       [],
    error:     null,
    output:    null,
    meta:      null,
    format:    null,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  saveJobsSoon();
  return job;
}

function pushLog(job, msg) {
  job.log.push(msg);
  if (job.log.length > 120) job.log.shift();
}

await loadJobs();

/* ─── Render job runner ──────────────────────────────────────────────────── */

function startJob(job, uploadedPath, options) {
  job.status = "running";
  saveJobsSoon();

  const outName = `${Date.now()}_${options.format}.mp4`;
  const outPath = path.join(RENDERS_DIR, outName);

  const onProgress = ({ stage, progress }) => {
    job.stage    = stage;
    job.progress = progress;
    pushLog(job, `[${String(progress).padStart(3)}%] ${stage}`);
    // Don't save on every tick — too noisy. Persist only on big state changes.
  };

  autoEdit(uploadedPath, outPath, options, onProgress)
    .then(({ segments, durationOut }) => {
      job.status   = "done";
      job.progress = 100;
      job.stage    = "done";
      job.output   = outName;
      job.meta     = { segments, durationOut };
      pushLog(job, `✓ ${outName} — ${durationOut}s, ${segments} segment(s)`);
      saveJobsSoon();
      fs.unlink(uploadedPath).catch(() => {});
    })
    .catch((err) => {
      job.status = "error";
      job.error  = err.message;
      pushLog(job, `✗ ${err.message}`);
      saveJobsSoon();
      fs.unlink(uploadedPath).catch(() => {});
    });
}

/* ─── Express ────────────────────────────────────────────────────────────── */

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use("/renders", express.static(RENDERS_DIR, { maxAge: "1d" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    jobs:   jobs.size,
    node:   process.version,
  });
});

app.post("/api/render", upload.single("clip"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "clip is required" });

  const body = req.body;
  const options = {
    format:         ["vertical", "landscape"].includes(body.format) ? body.format : "vertical",
    targetDuration: Math.max(15, Math.min(600, Number(body.targetDuration) || 180)),
    hookText:       (body.hookText || "").slice(0, 80),
    ctaText:        (body.ctaText  || "").slice(0, 80),
    accent:         /^#[0-9a-fA-F]{6}$/.test(body.accent) ? body.accent : "#FFF200",
    language:       body.language || "auto",
    autoCaption:    body.autoCaption !== "false",
    sfx:            body.sfx !== "false",
    progressBar:    body.progressBar !== "false",
    hookZoom:       body.hookZoom !== "false",
  };

  const job = newJob();
  job.format = options.format;

  setImmediate(() => startJob(job, req.file.path, options));
  res.json({ jobId: job.id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json({
    id:       job.id,
    status:   job.status,
    progress: job.progress,
    stage:    job.stage,
    error:    job.error,
    output:   job.output,
    meta:     job.meta,
    format:   job.format,
    elapsed:  Math.round((Date.now() - job.startedAt) / 1000),
    log:      job.log.slice(-40),
  });
});

// Recent jobs list (for history view, future use)
app.get("/api/jobs", (_req, res) => {
  const list = [...jobs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 30)
    .map((j) => ({
      id: j.id, status: j.status, output: j.output, format: j.format,
      startedAt: j.startedAt, meta: j.meta,
    }));
  res.json(list);
});

/* ─── LAN address discovery + QR code at startup ─────────────────────────── */

function lanAddresses() {
  const out = [];
  const nics = networkInterfaces();
  for (const list of Object.values(nics)) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

async function printStartupBanner(port) {
  const lines = [
    "",
    "  ┌────────────────────────────────────────┐",
    "  │  video-studio                          │",
    "  └────────────────────────────────────────┘",
    "",
  ];

  if (PUBLIC_URL) {
    lines.push(`  🌐  ${PUBLIC_URL}`);
  }
  lines.push(`  💻  http://localhost:${port}`);

  const lans = lanAddresses();
  for (const ip of lans) lines.push(`  📱  http://${ip}:${port}`);

  console.log(lines.join("\n"));

  // Pick the best URL for the QR
  const qrUrl = PUBLIC_URL || (lans[0] ? `http://${lans[0]}:${port}` : null);
  if (qrUrl) {
    try {
      const qr = await qrcode.toString(qrUrl, { type: "terminal", small: true });
      console.log("\n  scan with your phone camera:\n");
      console.log(qr);
    } catch {
      /* QR is optional */
    }
  } else {
    console.log("\n  (no LAN interface detected — server is loopback only)\n");
  }
}

app.listen(PORT, "0.0.0.0", () => printStartupBanner(PORT));
