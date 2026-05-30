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

const FORMATS = {
  landscape: {
    composition: null, // uses index.html
    resolution: null,
    defaultDuration: 21,
    variables: (b) => ({
      clipSrc: "assets/clip.mp4",
      clipStart: Number(b.clipStart || 0),
      clipDuration: Number(b.clipDuration || 21),
      introTitle: b.introTitle || "NEW DROP",
      introSubtitle: b.introSubtitle || "Coming this week",
      caption: b.caption || "Behind the scenes",
      outroTitle: b.outroTitle || "FOLLOW @SPNpeet",
      outroSubtitle: b.outroSubtitle || "More on the way",
      accent: b.accent || "#22d3ee",
    }),
  },
  vertical: {
    composition: "compositions/vertical.html",
    resolution: "portrait",
    defaultDuration: 17,
    variables: (b) => ({
      clipSrc: "assets/clip.mp4",
      clipStart: Number(b.clipStart || 0),
      clipDuration: Number(b.clipDuration || 17),
      hookText: b.hookText || b.introTitle || "Wait for it...",
      hookSub: b.hookSub || b.introSubtitle || "this is insane 🔥",
      midCaption: b.midCaption || b.caption || "Behind the scenes",
      ctaText: b.ctaText || b.outroTitle || "FOLLOW @SPNpeet",
      ctaSub: b.ctaSub || b.outroSubtitle || "new drops every week",
      accent: b.accent || "#f72585",
    }),
  },
};

await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(RENDERS_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: MAX_UPLOAD_BYTES } });
const jobs = new Map();

function createJob() {
  const id = randomUUID();
  const job = { id, status: "queued", progress: 0, stage: "queued", log: [], error: null, output: null, startedAt: Date.now() };
  jobs.set(id, job);
  return job;
}

const ANSI_PATTERN = /\[[0-9;?]*[A-Za-z]/g;

function pushLog(job, rawLine) {
  const line = rawLine.replace(ANSI_PATTERN, "").trim();
  if (!line) return;
  job.log.push(line);
  if (job.log.length > 200) job.log.shift();
  const match = /(\d{1,3})%\s+(.+)/.exec(line);
  if (match) { job.progress = Number(match[1]); job.stage = match[2].trim(); }
}

async function reencodeForSeek(srcPath, destPath) {
  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", srcPath,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-g", "30", "-keyint_min", "30",
      "-movflags", "+faststart", "-c:a", "aac", destPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    proc.on("error", reject);
    proc.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
}

function runRender(job, format, variables) {
  job.status = "running";
  job.stage = "starting hyperframes render";

  const fmt = FORMATS[format] || FORMATS.landscape;
  const args = ["--yes", "hyperframes@0.6.61", "render", "--variables", JSON.stringify(variables)];
  if (fmt.composition) args.push("--composition", fmt.composition);
  if (fmt.resolution) args.push("--resolution", fmt.resolution);

  const proc = spawn("npx", args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  let buf = "";
  const ingest = (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n|\r/);
    buf = lines.pop() ?? "";
    lines.forEach((l) => pushLog(job, l));
  };
  proc.stdout.on("data", ingest);
  proc.stderr.on("data", ingest);
  proc.on("error", (err) => { job.status = "error"; job.error = err.message; });
  proc.on("exit", async (code) => {
    if (buf.trim()) pushLog(job, buf);
    if (code !== 0) { job.status = "error"; job.error = `render exited ${code}`; return; }
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
      job.status = "error"; job.error = err.message;
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

    const format = FORMATS[req.body.format] ? req.body.format : "landscape";
    const fmt = FORMATS[format];
    const variables = fmt.variables(req.body);
    const job = createJob();
    job.format = format;

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

    runRender(job, format, variables);
    res.json({ jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json({
    id: job.id, status: job.status, progress: job.progress,
    stage: job.stage, error: job.error, output: job.output,
    format: job.format,
    elapsed: Math.round((Date.now() - job.startedAt) / 1000),
    log: job.log.slice(-30),
  });
});

app.listen(PORT, () => console.log(`video-studio web · http://localhost:${PORT}`));
