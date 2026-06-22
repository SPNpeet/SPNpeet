import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

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

console.log("── SERVER ENDPOINTS ──");
const { proc } = await startServer();
try {
  const health = await (await fetch("http://localhost:4399/health")).json();
  ok("/health ok", health.ok === true);
  ok("/health has uptime", health.uptime > 0);
  ok("/health has node version", health.node?.startsWith("v"));

  const homeRes = await fetch("http://localhost:4399/");
  const homeText = await homeRes.text();
  ok("/ returns 200", homeRes.ok);
  ok("/ has manifest link", homeText.includes('rel="manifest"'));
  ok("/ has apple-touch-icon", homeText.includes("apple-touch-icon"));
  ok("/ has theme-color", homeText.includes("theme-color"));

  const assets = [
    "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png",
    "/apple-touch-icon.png", "/favicon-32.png", "/service-worker.js",
    "/style.css", "/app.js",
  ];
  for (const a of assets) {
    const r = await fetch("http://localhost:4399" + a);
    ok(`asset ${a} 200`, r.ok, "" + r.status);
  }

  const manifest = await (await fetch("http://localhost:4399/manifest.webmanifest")).json();
  ok("manifest has name", !!manifest.name);
  ok("manifest has icons[]", Array.isArray(manifest.icons) && manifest.icons.length > 0);
  ok("manifest start_url=/", manifest.start_url === "/");
  ok("manifest display=standalone", manifest.display === "standalone");
  ok("manifest theme_color", !!manifest.theme_color);

  const jobsRes = await fetch("http://localhost:4399/api/jobs");
  const jobs = await jobsRes.json();
  ok("/api/jobs is array", Array.isArray(jobs));

  const noJob = await fetch("http://localhost:4399/api/jobs/non-existent-id");
  ok("/api/jobs/:missing → 404", noJob.status === 404);

  const noFile = await fetch("http://localhost:4399/api/render", { method: "POST" });
  ok("POST /api/render no file → 400", noFile.status === 400);
} finally {
  proc.kill();
  await new Promise(r => setTimeout(r, 500));
}

console.log("\n── ENV VAR DETECTION ──");

// RENDER_EXTERNAL_URL
{
  const { proc, banner } = await startServer({ RENDER_EXTERNAL_URL: "https://render-test.onrender.com" });
  await new Promise(r => setTimeout(r, 300));
  proc.kill();
  await new Promise(r => setTimeout(r, 300));
  ok("RENDER_EXTERNAL_URL in banner", banner().includes("render-test.onrender.com"));
}

// FLY_APP_NAME
{
  const { proc, banner } = await startServer({ FLY_APP_NAME: "fly-test-app" });
  await new Promise(r => setTimeout(r, 300));
  proc.kill();
  await new Promise(r => setTimeout(r, 300));
  ok("FLY_APP_NAME → fly.dev banner", banner().includes("fly-test-app.fly.dev"));
}

// PUBLIC_URL priority
{
  const { proc, banner } = await startServer({
    PUBLIC_URL: "https://wins.example.com",
    RENDER_EXTERNAL_URL: "https://loses.onrender.com",
  });
  await new Promise(r => setTimeout(r, 300));
  proc.kill();
  await new Promise(r => setTimeout(r, 300));
  const b = banner();
  ok("PUBLIC_URL overrides RENDER_EXTERNAL_URL", b.includes("wins.example.com") && !b.includes("loses.onrender.com"));
}

console.log("\n" + pass + " passed · " + fail + " failed");
if (fails.length) console.log("failures:\n  " + fails.join("\n  "));
process.exit(fail > 0 ? 1 : 0);
