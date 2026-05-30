/* ─── Elements ─────────────────────────────────────────────────────────────── */
const form       = document.getElementById("render-form");
const submitBtn  = document.getElementById("submit-btn");
const btnLabel   = document.getElementById("btn-label");
const fileInput  = document.getElementById("file-input");
const dzText     = document.getElementById("dz-text");
const dropzone   = document.getElementById("dropzone");
const durSlider  = document.getElementById("dur-slider");
const durVal     = document.getElementById("dur-val");
const statusCard = document.getElementById("status-card");
const statusBadge = document.getElementById("status-badge");
const statusTitle = document.getElementById("status-title");
const progFill   = document.getElementById("prog-fill");
const progPct    = document.getElementById("prog-pct");
const stageText  = document.getElementById("stage-text");
const elapsedText = document.getElementById("elapsed-text");
const logBox     = document.getElementById("log-box");
const resultBox  = document.getElementById("result-box");
const resultMeta = document.getElementById("result-meta");
const resultVideo = document.getElementById("result-video");
const dlLink     = document.getElementById("dl-link");
const newBtn     = document.getElementById("new-btn");
const errorBox   = document.getElementById("error-box");

/* ─── Duration slider ───────────────────────────────────────────────────────── */
function fmtSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}
durSlider.addEventListener("input", () => {
  durVal.textContent = fmtSeconds(Number(durSlider.value));
});

/* ─── File drop ─────────────────────────────────────────────────────────────── */
function setFile(file) {
  if (!file || !file.type.startsWith("video/")) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  dzText.innerHTML = `<strong>${file.name}</strong><br/><small>${(file.size / 1e6).toFixed(1)} MB · click to change</small>`;
}

fileInput.addEventListener("change", () => setFile(fileInput.files?.[0]));

["dragover", "dragenter"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("drag-over"); })
);
["dragleave", "drop"].forEach(ev =>
  dropzone.addEventListener(ev, () => dropzone.classList.remove("drag-over"))
);
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  setFile(e.dataTransfer?.files?.[0]);
});

/* ─── Submit ────────────────────────────────────────────────────────────────── */
form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!fileInput.files?.[0]) return;

  resetStatus();
  statusCard.classList.remove("hidden");
  submitBtn.disabled = true;
  btnLabel.textContent = "กำลังอัปโหลด…";

  let jobId;
  try {
    const res  = await fetch("/api/render", { method: "POST", body: new FormData(form) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    jobId = data.jobId;
  } catch (err) {
    showError(err.message);
    return;
  }

  btnLabel.textContent = "Rendering…";
  pollJob(jobId);
});

/* ─── New render button ─────────────────────────────────────────────────────── */
newBtn.addEventListener("click", () => {
  statusCard.classList.add("hidden");
  submitBtn.disabled = false;
  btnLabel.textContent = "▸  Render คลิป";
});

/* ─── Poll ──────────────────────────────────────────────────────────────────── */
async function pollJob(id) {
  const tick = async () => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || "Job error");

      progFill.style.width = `${job.progress}%`;
      progPct.textContent  = `${job.progress}%`;
      stageText.textContent  = job.stage  || job.status;
      elapsedText.textContent = `${job.elapsed}s`;
      logBox.textContent     = (job.log || []).join("\n");
      logBox.scrollTop       = logBox.scrollHeight;

      if (job.status === "done" && job.output) {
        markDone(job);
        return;
      }
      if (job.status === "error") {
        showError(job.error || "render failed");
        return;
      }
      setTimeout(tick, 1200);
    } catch (err) {
      showError(err.message);
    }
  };
  tick();
}

function markDone(job) {
  statusBadge.textContent  = "done ✓";
  statusBadge.className    = "badge badge-done";
  statusTitle.textContent  = "เสร็จแล้ว";

  const url = `/renders/${encodeURIComponent(job.output)}`;
  resultVideo.src  = url;
  dlLink.href      = url;
  dlLink.download  = job.output;

  const fmtLabel = job.format === "vertical" ? "📱 1080×1920 (TikTok/IG)" : "🖥 1920×1080 (YouTube)";
  const dur      = job.meta?.durationOut ? `${job.meta.durationOut}s` : "";
  const segs     = job.meta?.segments    ? ` · ${job.meta.segments} segments` : "";
  resultMeta.textContent = `${fmtLabel}  ${dur}${segs}`;

  resultBox.classList.remove("hidden");
  submitBtn.disabled  = false;
  btnLabel.textContent = "▸  Render คลิป";
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function resetStatus() {
  progFill.style.width    = "0%";
  progPct.textContent     = "0%";
  stageText.textContent   = "queued";
  elapsedText.textContent = "0s";
  logBox.textContent      = "";
  resultBox.classList.add("hidden");
  errorBox.classList.add("hidden");
  statusBadge.textContent = "running";
  statusBadge.className   = "badge badge-running";
  statusTitle.textContent = "กำลัง render…";
}

function showError(msg) {
  statusBadge.textContent = "error";
  statusBadge.className   = "badge badge-error";
  statusTitle.textContent = "เกิดข้อผิดพลาด";
  errorBox.textContent    = msg;
  errorBox.classList.remove("hidden");
  submitBtn.disabled      = false;
  btnLabel.textContent    = "▸  ลองใหม่";
}
