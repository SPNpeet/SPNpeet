import { probe, detectScenes, detectSilences } from "../pipeline/analyze.js";
import { chooseSegments } from "../pipeline/segments.js";
import { makeWhoosh, makeImpact } from "../pipeline/sfx.js";
import { whisperAvailable } from "../pipeline/captions.js";
import { existsSync } from "node:fs";

let pass = 0, fail = 0;
const fails = [];
const ok = (label, cond, detail = "") => {
  cond ? pass++ : fail++;
  if (!cond) fails.push(label);
  console.log((cond ? "  ✓" : "  ✗"), label, detail ? "· " + detail : "");
};

console.log("── PROBE ──");
const meta = await probe("assets/clip.mp4");
ok("duration>0", meta.duration > 0, meta.duration + "s");
ok("width=1920", meta.width === 1920);
ok("height=1080", meta.height === 1080);
ok("hasAudio", meta.hasAudio === true);

console.log("── ANALYSIS ──");
const scenes = await detectScenes("assets/clip.mp4");
ok("scenes is array", Array.isArray(scenes), scenes.length + " scenes");
const silences = await detectSilences("assets/clip.mp4");
ok("silences is array", Array.isArray(silences), silences.length + " silences");

console.log("── SEGMENTS ──");
ok("short target uses full", chooseSegments(meta, 30, [], []).length === 1);
const longMeta = { duration: 300, fps: 30, width: 1920, height: 1080 };
const segs60 = chooseSegments(longMeta, 60, [], []);
ok("long source multi-segs", segs60.length >= 2);
const total = segs60.reduce((s, x) => s + (x.end - x.start), 0);
ok("total close to target", Math.abs(total - 60) < 5, total + "s");
ok("first=hook", segs60[0].kind === "hook");
ok("last=outro", segs60[segs60.length - 1].kind === "outro");

console.log("── SFX ──");
await makeWhoosh("/tmp/a_whoosh.wav");
ok("whoosh created", existsSync("/tmp/a_whoosh.wav"));
await makeImpact("/tmp/a_impact.wav");
ok("impact created", existsSync("/tmp/a_impact.wav"));

console.log("── WHISPER ──");
const wa = await whisperAvailable();
ok("whisper available check", typeof wa === "boolean", String(wa));

console.log();
console.log(pass + " passed · " + fail + " failed");
if (fails.length) console.log("failures:", fails.join(", "));
process.exit(fail > 0 ? 1 : 0);
