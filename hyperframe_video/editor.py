import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path


class FFmpegNotFoundError(RuntimeError):
    pass


class FFmpegError(RuntimeError):
    def __init__(self, message: str, stderr: str = ""):
        super().__init__(message)
        self.stderr = stderr


@dataclass
class EditOptions:
    start: float | None = None
    end: float | None = None
    width: int | None = None
    height: int | None = None
    fps: int | None = None
    bitrate: str | None = None
    mute: bool = False
    fade_in: float | None = None
    fade_out: float | None = None
    overlay_text: str | None = None
    extra_filters: list[str] = field(default_factory=list)


def _require_ffmpeg() -> str:
    binary = shutil.which("ffmpeg")
    if not binary:
        raise FFmpegNotFoundError("ffmpeg not found on PATH")
    return binary


def _require_ffprobe() -> str:
    binary = shutil.which("ffprobe")
    if not binary:
        raise FFmpegNotFoundError("ffprobe not found on PATH")
    return binary


def probe_duration(path: Path) -> float:
    ffprobe = _require_ffprobe()
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise FFmpegError("ffprobe failed", stderr=result.stderr)
    data = json.loads(result.stdout or "{}")
    return float(data.get("format", {}).get("duration", 0.0))


class VideoEditor:
    def __init__(self, source: Path):
        self.source = Path(source)
        if not self.source.exists():
            raise FileNotFoundError(self.source)

    def render(self, output: Path, options: EditOptions) -> Path:
        ffmpeg = _require_ffmpeg()
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)

        cmd: list[str] = [ffmpeg, "-y"]
        if options.start is not None:
            cmd += ["-ss", f"{options.start}"]
        if options.end is not None:
            cmd += ["-to", f"{options.end}"]
        cmd += ["-i", str(self.source)]

        video_filters = self._build_video_filters(options)
        if video_filters:
            cmd += ["-vf", ",".join(video_filters)]

        if options.fps:
            cmd += ["-r", str(options.fps)]
        if options.bitrate:
            cmd += ["-b:v", options.bitrate]

        if options.mute:
            cmd += ["-an"]
        else:
            audio_filters = self._build_audio_filters(options)
            if audio_filters:
                cmd += ["-af", ",".join(audio_filters)]
            cmd += ["-c:a", "aac"]

        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        cmd += [str(output)]

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise FFmpegError(f"ffmpeg exited {result.returncode}", stderr=result.stderr)
        return output

    def thumbnail(self, output: Path, at: float = 0.5) -> Path:
        ffmpeg = _require_ffmpeg()
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        duration = probe_duration(self.source)
        timestamp = max(0.0, min(duration * at, max(duration - 0.1, 0.0)))
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            f"{timestamp}",
            "-i",
            str(self.source),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(output),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise FFmpegError("thumbnail extraction failed", stderr=result.stderr)
        return output

    def _build_video_filters(self, options: EditOptions) -> list[str]:
        filters: list[str] = []
        if options.width or options.height:
            w = options.width or -2
            h = options.height or -2
            filters.append(f"scale={w}:{h}")

        clip_duration = self._clip_duration(options)
        if options.fade_in:
            filters.append(f"fade=t=in:st=0:d={options.fade_in}")
        if options.fade_out and clip_duration:
            start = max(clip_duration - options.fade_out, 0.0)
            filters.append(f"fade=t=out:st={start}:d={options.fade_out}")

        if options.overlay_text:
            text = options.overlay_text.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
            filters.append(
                "drawtext=text='" + text + "':fontcolor=white:fontsize=36:"
                "x=(w-text_w)/2:y=h-th-40:box=1:boxcolor=black@0.5:boxborderw=12"
            )

        filters.extend(options.extra_filters)
        return filters

    def _build_audio_filters(self, options: EditOptions) -> list[str]:
        filters: list[str] = []
        clip_duration = self._clip_duration(options)
        if options.fade_in:
            filters.append(f"afade=t=in:st=0:d={options.fade_in}")
        if options.fade_out and clip_duration:
            start = max(clip_duration - options.fade_out, 0.0)
            filters.append(f"afade=t=out:st={start}:d={options.fade_out}")
        return filters

    def _clip_duration(self, options: EditOptions) -> float | None:
        if options.start is not None and options.end is not None:
            return max(options.end - options.start, 0.0)
        if options.end is not None:
            return options.end
        try:
            duration = probe_duration(self.source)
        except (FFmpegError, FFmpegNotFoundError):
            return None
        if options.start is not None:
            return max(duration - options.start, 0.0)
        return duration
