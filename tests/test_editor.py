from pathlib import Path

import pytest

from hyperframe_video.editor import EditOptions, VideoEditor


@pytest.fixture
def fake_source(tmp_path: Path) -> Path:
    path = tmp_path / "src.mp4"
    path.write_bytes(b"\x00")
    return path


def test_video_editor_requires_existing_source(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        VideoEditor(tmp_path / "missing.mp4")


def test_clip_duration_uses_explicit_window(fake_source: Path):
    editor = VideoEditor(fake_source)
    options = EditOptions(start=2.0, end=5.0)
    assert editor._clip_duration(options) == pytest.approx(3.0)


def test_video_filters_include_scale_and_fade(fake_source: Path, monkeypatch):
    monkeypatch.setattr(
        "hyperframe_video.editor.probe_duration",
        lambda _path: 10.0,
    )
    editor = VideoEditor(fake_source)
    filters = editor._build_video_filters(
        EditOptions(width=720, fade_in=1.0, fade_out=1.5)
    )
    assert any(f.startswith("scale=720:-2") for f in filters)
    assert any("fade=t=in" in f for f in filters)
    assert any("fade=t=out" in f for f in filters)


def test_overlay_text_is_escaped(fake_source: Path):
    editor = VideoEditor(fake_source)
    filters = editor._build_video_filters(
        EditOptions(start=0, end=2, overlay_text="hi: it's me")
    )
    drawtext = next(f for f in filters if f.startswith("drawtext"))
    assert "\\:" in drawtext
    assert "\\'" in drawtext


def test_audio_filters_skip_when_no_fade(fake_source: Path):
    editor = VideoEditor(fake_source)
    assert editor._build_audio_filters(EditOptions(start=0, end=1)) == []
