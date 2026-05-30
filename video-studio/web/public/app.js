const form = document.getElementById("render-form");
const submitBtn = document.getElementById("submit-btn");
const statusCard = document.getElementById("status-card");
const barFill = document.getElementById("bar-fill");
const barText = document.getElementById("bar-text");
const stageText = document.getElementById("stage-text");
const elapsedText = document.getElementById("elapsed-text");
const logOutput = document.getElementById("log-output");
const result = document.getElementById("result");
const resultVideo = document.getElementById("result-video");
const downloadLink = document.getElementById("download-link");
const errorBox = document.getElementById("error-box");
const fileInput = form.querySelector('input[type="file"]');
const fileLabel = form.querySelector(".file");
const fileText = form.querySelector(".file-text");
const accentInput = document.getElementById("accent-input");
const accentHint = document.getElementById("accent-hint");
const fieldsLandscape = document.getElementById("fields-landscape");
const fieldsVertical = document.getElementById("fields-vertical");
const clipDurationInput = document.getElementById("clip-duration");
const formatRadios = form.querySelectorAll('input[name="format"]');

/* ── Format toggle ── */
const ACCENT_DEFAULTS = { landscape: "#22d3ee", vertical: "#f72585" };
const ACCENT_HINTS = { landscape: "cyan · landscape default", vertical: "pink · TikTok/IG default" };
const DUR_DEFAULTS = { landscape: "21", vertical: "17" };

function applyFormat(fmt) {
  fieldsLandscape.style.display = fmt === "landscape" ? "" : "none";
  fieldsVertical.style.display = fmt === "vertical" ? "" : "none";
  accentInput.value = ACCENT_DEFAULTS[fmt];
  accentHint.textContent = ACCENT_HINTS[fmt];
  if (!clipDurationInput._touched) clipDurationInput.value = DUR_DEFAULTS[fmt];
}
clipDurationInput.addEventListener("input", () => { clipDurationInput._touched = true; });
formatRadios.forEach((r) => r.addEventListener("change", () => applyFormat(r.value)));
applyFormat("landscape");

/* ── File picker ── */
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) fileText.textContent = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`;
});

/* Drag-and-drop */
["dragover", "dragenter"].forEach((ev) =>
  fileLabel.addEventListener(ev, (e) => { e.preventDefault(); fileLabel.style.borderColor = "var(--accent)"; })
);
["dragleave", "drop"].forEach((ev) =>
  fileLabel.addEventListener(ev, () => { fileLabel.style.borderColor = ""; })
);
fileLabel.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith("video/")) {
    const dt = new DataTransfer();
    dt.items.add(f);
    fileInput.files = dt.files;
    fileText.textContent = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`;
  }
});

/* ── Submit ── */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!fileInput.files?.[0]) return;

  resetStatus();
  statusCard.classList.remove("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "อัปโหลด…";

  let jobId;
  try {
    const res = await fetch("/api/render", { method: "POST", body: new FormData(form) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "upload failed");
    jobId = data.jobId;
  } catch (err) {
    showError(err.message);
    return;
  }

  submitBtn.textContent = "rendering…";
  pollJob(jobId);
});

function resetStatus() {
  barFill.style.width = "0%";
  barText.textContent = "0%";
  stageText.textContent = "queued";
  elapsedText.textContent = "0s";
  logOutput.textContent = "";
  result.classList.add("hidden");
  errorBox.classList.add("hidden");
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
  submitBtn.disabled = false;
  submitBtn.textContent = "▸ Render";
}

async function pollJob(id) {
  const tick = async () => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || "job error");

      barFill.style.width = `${job.progress}%`;
      barText.textContent = `${job.progress}%`;
      stageText.textContent = job.stage || job.status;
      elapsedText.textContent = `${job.elapsed}s elapsed`;
      logOutput.textContent = (job.log || []).join("\n");
      logOutput.scrollTop = logOutput.scrollHeight;

      if (job.status === "done" && job.output) {
        const url = `/renders/${encodeURIComponent(job.output)}`;
        resultVideo.src = url;
        downloadLink.href = url;
        const fmtBadge = job.format === "vertical" ? "📱 1080×1920" : "🖥 1920×1080";
        document.getElementById("status-title").textContent = `เสร็จแล้ว — ${fmtBadge}`;
        result.classList.remove("hidden");
        submitBtn.disabled = false;
        submitBtn.textContent = "▸ Render อีกครั้ง";
        return;
      }
      if (job.status === "error") { showError(job.error || "render failed"); return; }
      setTimeout(tick, 1000);
    } catch (err) {
      showError(err.message);
    }
  };
  tick();
}
