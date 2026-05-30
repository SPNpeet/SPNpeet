import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "assets");
const UPLOAD_DIR = path.join(ASSETS_DIR, "_uploads");
const RENDERS_DIR = path.join(PROJECT_ROOT, "renders");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 4321;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(RENDERS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const jobs = new Map();

function createJob() {
  const id = randomUUID();
  const job = {
    id,
    status: "queued",
    progress: 0,
    stage: "queued",
    log: [],
    error: null,
    output: null,
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

const ANSI_PATTERN = /\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(s) {
  return s.replace(ANSI_PATTERN, "");
}

function pushLog(job, rawLine) {
  const line = stripAnsi(rawLine).trim();
  if (!line) return;
  job.log.push(line);
  if (job.log.length > 200) job.log.shift();
  const match = /(\d{1,3})%\s+(.+)/.exec(line);
  if (match) {
    job.progress = Number(match[1]);
    job.stage = match[2].trim();
  }
}

async function reencodeForSeek(srcPath, destPath) {
  await new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        srcPath,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-g",
        "30",
        "-keyint_min",
        "30",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        destPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))
    );
  });
}

function runRender(job, variables) {
  job.status = "running";
  job.stage = "starting hyperframes render";

  const variablesJson = JSON.stringify(variables);
  const renderArgs = [
    "--yes",
    "hyperframes@0.6.61",
    "render",
    "--variables",
    variablesJson,
  ];
  const proc = spawn("npx", renderArgs, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  let buffer = "";
  const ingest = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) pushLog(job, line);
    }
  };
  proc.stdout.on("data", ingest);
  proc.stderr.on("data", ingest);

  proc.on("error", (err) => {
    job.status = "error";
    job.error = err.message;
  });

  proc.on("exit", async (code) => {
    if (buffer.trim()) pushLog(job, buffer);
    if (code !== 0) {
      job.status = "error";
      job.error = `render exited with code ${code}`;
      return;
    }
    try {
      const files = await fs.readdir(RENDERS_DIR);
      const newest = files
        .filter((f) => f.endsWith(".mp4"))
        .map((name) => ({ name, mtime: statSync(path.join(RENDERS_DIR, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0];
      if (!newest) throw new Error("no MP4 produced");
      job.output = newest.name;
      job.progress = 100;
      job.stage = "done";
      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = err.message;
    }
  });
}

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use("/renders", express.static(RENDERS_DIR));

app.post("/api/render", upload.single("clip"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "clip file is required" });

    const variables = {
      clipSrc: "assets/clip.mp4",
      clipStart: Number(req.body.clipStart || 0),
      clipDuration: Number(req.body.clipDuration || 21),
      introTitle: req.body.introTitle || "NEW DROP",
      introSubtitle: req.body.introSubtitle || "Coming this week",
      caption: req.body.caption || "Behind the scenes",
      outroTitle: req.body.outroTitle || "FOLLOW @SPNpeet",
      outroSubtitle: req.body.outroSubtitle || "More on the way",
      accent: req.body.accent || "#22d3ee",
    };

    const job = createJob();

    const clipDest = path.join(ASSETS_DIR, "clip.mp4");
    try {
      await reencodeForSeek(req.file.path, clipDest);
    } catch (err) {
      job.status = "error";
      job.error = `ffmpeg re-encode failed: ${err.message}`;
      return res.status(500).json({ error: job.error });
    } finally {
      await fs.unlink(req.file.path).catch(() => {});
    }

    runRender(job, variables);
    res.json({ jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    output: job.output,
    elapsed: Math.round((Date.now() - job.startedAt) / 1000),
    log: job.log.slice(-30),
  });
});

app.listen(PORT, () => {
  console.log(`video-studio web · http://localhost:${PORT}`);
});
