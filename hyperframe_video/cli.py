import argparse
import sys
from pathlib import Path
from urllib.parse import urljoin

from .editor import (
    EditOptions,
    FFmpegError,
    FFmpegNotFoundError,
    VideoEditor,
)
from .frame import FrameMetadata, HyperframeBuilder


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hyperframe-video",
        description="Edit a video clip and publish it as a Farcaster Hyperframe.",
    )
    parser.add_argument("source", type=Path, help="Input video file")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("dist"),
        help="Output directory (default: ./dist)",
    )
    parser.add_argument("--name", default="clip", help="Base name for generated files")

    edit = parser.add_argument_group("edit")
    edit.add_argument("--start", type=float, help="Trim start time in seconds")
    edit.add_argument("--end", type=float, help="Trim end time in seconds")
    edit.add_argument("--width", type=int, help="Target width in pixels")
    edit.add_argument("--height", type=int, help="Target height in pixels")
    edit.add_argument("--fps", type=int, help="Target frame rate")
    edit.add_argument("--bitrate", help="Target video bitrate, e.g. 2M")
    edit.add_argument("--mute", action="store_true", help="Strip audio")
    edit.add_argument("--fade-in", type=float, help="Fade-in duration in seconds")
    edit.add_argument("--fade-out", type=float, help="Fade-out duration in seconds")
    edit.add_argument("--overlay-text", help="Burn-in caption text")
    edit.add_argument(
        "--filter",
        dest="filters",
        action="append",
        default=[],
        help="Extra ffmpeg video filter (repeatable)",
    )

    frame = parser.add_argument_group("hyperframe")
    frame.add_argument("--title", required=True, help="Frame title")
    frame.add_argument("--description", default="", help="Frame description")
    frame.add_argument("--button-title", default="Watch", help="Button label")
    frame.add_argument(
        "--base-url",
        required=True,
        help="Public base URL where output files will be served",
    )
    frame.add_argument("--target-url", help="Override launch URL (defaults to video URL)")
    frame.add_argument("--splash-image", help="Splash image URL for Frames v2")
    frame.add_argument(
        "--splash-color",
        default="#000000",
        help="Splash background color (default: #000000)",
    )
    frame.add_argument(
        "--aspect-ratio",
        default="1.91:1",
        choices=["1.91:1", "1:1"],
        help="Frame image aspect ratio",
    )
    frame.add_argument(
        "--skip-render",
        action="store_true",
        help="Skip ffmpeg and only generate the Hyperframe HTML",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    video_path = out_dir / f"{args.name}.mp4"
    poster_path = out_dir / f"{args.name}.jpg"
    html_path = out_dir / f"{args.name}.html"
    manifest_path = out_dir / f"{args.name}.frame.json"

    try:
        editor = VideoEditor(args.source)
        if not args.skip_render:
            options = EditOptions(
                start=args.start,
                end=args.end,
                width=args.width,
                height=args.height,
                fps=args.fps,
                bitrate=args.bitrate,
                mute=args.mute,
                fade_in=args.fade_in,
                fade_out=args.fade_out,
                overlay_text=args.overlay_text,
                extra_filters=list(args.filters),
            )
            editor.render(video_path, options)
            editor.thumbnail(poster_path)
            print(f"rendered video -> {video_path}")
            print(f"rendered poster -> {poster_path}")
        else:
            if not video_path.exists():
                video_path.symlink_to(args.source.resolve())
            if not poster_path.exists():
                editor.thumbnail(poster_path)
    except FFmpegNotFoundError as exc:
        print(f"error: {exc}. Install ffmpeg and try again.", file=sys.stderr)
        return 2
    except FFmpegError as exc:
        print(f"ffmpeg error: {exc}", file=sys.stderr)
        if exc.stderr:
            print(exc.stderr, file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"error: source file not found: {exc}", file=sys.stderr)
        return 2

    base_url = args.base_url if args.base_url.endswith("/") else args.base_url + "/"
    metadata = FrameMetadata(
        title=args.title,
        description=args.description,
        button_title=args.button_title,
        image_url=urljoin(base_url, poster_path.name),
        video_url=urljoin(base_url, video_path.name),
        target_url=args.target_url or urljoin(base_url, html_path.name),
        splash_image_url=args.splash_image,
        splash_background_color=args.splash_color,
        aspect_ratio=args.aspect_ratio,
    )
    builder = HyperframeBuilder(metadata=metadata)
    builder.write_html(html_path)
    builder.write_manifest(manifest_path)
    print(f"wrote hyperframe -> {html_path}")
    print(f"wrote manifest -> {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
