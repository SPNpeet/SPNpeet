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
const fileText = form.querySelector(".file-text");

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    fileText.textContent = `${file.name} · ${mb} MB`;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!fileInput.files?.[0]) return;

  resetStatus();
  statusCard.classList.remove("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "uploading…";

  const formData = new FormData(form);

  let jobId;
  try {
    const res = await fetch("/api/render", { method: "POST", body: formData });
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
  errorBox.textContent = "";
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
      if (!res.ok) throw new Error(job.error || "job lookup failed");

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
        result.classList.remove("hidden");
        submitBtn.disabled = false;
        submitBtn.textContent = "▸ Render again";
        return;
      }
      if (job.status === "error") {
        showError(job.error || "render failed");
        return;
      }
      setTimeout(tick, 1000);
    } catch (err) {
      showError(err.message);
    }
  };
  tick();
}
