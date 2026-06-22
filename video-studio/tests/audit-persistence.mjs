import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";

let pass = 0, fail = 0;
const fails = [];
const ok = (label, cond, detail = "") => {
  cond ? pass++ : fail++;
  if (!cond) fails.push(label + (detail ? " (" + detail + ")" : ""));
  console.log((cond ? "  ✓" : "  ✗"), label, detail ? "· " + detail : "");
};

async function startServer(env = {}) {
  const proc = spawn("node", ["web/server.js"], {
    env: { ...process.env, PORT: "4399", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  proc.stdout.on("data", d => buf += d);
  proc.stderr.on("data", d => buf += d);
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const r = await fetch("http://localhost:4399/health");
      if (r.ok) return { proc, banner: () => buf };
    } catch {}
  }
  proc.kill();
  throw new Error("server didn't start: " + buf.slice(0, 400));
}

console.log("── E2E VIA HTTP ──");
const { proc } = await startServer();
try {
  const fd = new FormData();
  const fileBuf = await fs.readFile("assets/clip.mp4");
  fd.append("clip", new Blob([fileBuf]), "clip.mp4");
  fd.append("format", "vertical");
  fd.append("targetDuration", "18");
  fd.append("hookText", "E2E");
  fd.append("ctaText", "OK");

  const submit = await fetch("http://localhost:4399/api/render", { method: "POST", body: fd });
  const sj = await submit.json();
  ok("submit returns jobId", !!sj.jobId);

  let final = null;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const r = await fetch("http://localhost:4399/api/jobs/" + sj.jobId);
    final = await r.json();
    if (final.status === "done" || final.status === "error") break;
  }
  ok("job completed via HTTP", final?.status === "done", final?.error || "");
  if (final?.output) {
    const dl = await fetch("http://localhost:4399/renders/" + encodeURIComponent(final.output));
    ok("render file downloadable",
       dl.ok && parseInt(dl.headers.get("content-length")) > 1000,
       dl.headers.get("content-length") + "b");
  }
} finally {
  proc.kill();
  await new Promise(r => setTimeout(r, 500));
}

console.log("\n── JOB DB PERSISTENCE ──");
const tmpData = "/tmp/audit_data";
const tmpRenders = "/tmp/audit_renders";
await fs.rm(tmpData,    { recursive: true, force: true });
await fs.rm(tmpRenders, { recursive: true, force: true });
await fs.mkdir(tmpData,    { recursive: true });
await fs.mkdir(tmpRenders, { recursive: true });

const env = { DATA_DIR: tmpData, RENDERS_DIR: tmpRenders };

const first = await startServer(env);
const fd2 = new FormData();
fd2.append("clip", new Blob([await fs.readFile("assets/clip.mp4")]), "clip.mp4");
fd2.append("format", "vertical");
fd2.append("targetDuration", "18");
const sj = await (await fetch("http://localhost:4399/api/render", { method: "POST", body: fd2 })).json();
ok("first boot accepts job", !!sj.jobId);
await new Promise(r => setTimeout(r, 2500));
first.proc.kill("SIGKILL");
await new Promise(r => setTimeout(r, 1500));

const second = await startServer(env);
await new Promise(r => setTimeout(r, 400));
const restored = await (await fetch("http://localhost:4399/api/jobs/" + sj.jobId)).json();
ok("job restored after restart", restored?.id === sj.jobId);
ok("interrupted job marked error",
   restored.status === "error" && /interrupt/i.test(restored.error || ""),
   restored.status + "/" + (restored.error || ""));

const list = await (await fetch("http://localhost:4399/api/jobs")).json();
ok("history list returns array", Array.isArray(list) && list.length >= 1);

second.proc.kill();
await new Promise(r => setTimeout(r, 300));

console.log("\n" + pass + " passed · " + fail + " failed");
if (fails.length) console.log("failures:\n  " + fails.join("\n  "));
process.exit(fail > 0 ? 1 : 0);
