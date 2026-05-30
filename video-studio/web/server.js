import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoEdit } from "../pipeline/auto_edit.js";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, "..");
const UPLOAD_DIR  = path.join(ROOT, "assets", "_uploads");
const RENDERS_DIR = path.join(ROOT, "renders");
const PUBLIC_DIR  = path.join(__dirname, "public");
const PORT        = Number(process.env.PORT) || 4321;

await fs.mkdir(UPLOAD_DIR,  { recursive: true });
await fs.mkdir(RENDERS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// ─── Job store ───────────────────────────────────────────────────────────────

const jobs = new Map();

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
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

function pushLog(job, msg) {
  job.log.push(msg);
  if (job.log.length > 120) job.log.shift();
}

// ─── Render job runner ───────────────────────────────────────────────────────

function startJob(job, uploadedPath, options) {
  job.status = "running";

  const outName = `${Date.now()}_${options.format}.mp4`;
  const outPath = path.join(RENDERS_DIR, outName);

  const onProgress = ({ stage, progress }) => {
    job.stage    = stage;
    job.progress = progress;
    pushLog(job, `[${String(progress).padStart(3)}%] ${stage}`);
  };

  autoEdit(uploadedPath, outPath, options, onProgress)
    .then(({ segments, durationOut }) => {
      job.status   = "done";
      job.progress = 100;
      job.stage    = "done";
      job.output   = outName;
      job.meta     = { segments, durationOut };
      pushLog(job, `✓ ${outName} — ${durationOut}s, ${segments} segment(s)`);
      fs.unlink(uploadedPath).catch(() => {});
    })
    .catch((err) => {
      job.status = "error";
      job.error  = err.message;
      pushLog(job, `✗ ${err.message}`);
      fs.unlink(uploadedPath).catch(() => {});
    });
}

// ─── Express ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use("/renders", express.static(RENDERS_DIR));

app.post("/api/render", upload.single("clip"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "clip is required" });

  const body = req.body;
  const options = {
    format:         ["vertical", "landscape"].includes(body.format) ? body.format : "vertical",
    targetDuration: Math.max(30, Math.min(600, Number(body.targetDuration) || 180)),
    hookText:       (body.hookText  || "").slice(0, 80),
    caption:        (body.caption   || "").slice(0, 80),
    ctaText:        (body.ctaText   || "").slice(0, 80),
  };

  const job = newJob();
  job.format = options.format;

  // Start async — respond immediately with jobId
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

app.listen(PORT, () =>
  console.log(`video-studio  →  http://localhost:${PORT}`)
);
