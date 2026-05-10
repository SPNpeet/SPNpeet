import json
from pathlib import Path

from hyperframe_video.frame import FrameMetadata, HyperframeBuilder


def _meta(**overrides) -> FrameMetadata:
    base = dict(
        title="Demo clip",
        image_url="https://cdn.example.com/clip.jpg",
        video_url="https://cdn.example.com/clip.mp4",
        button_title="Play",
        target_url="https://cdn.example.com/clip.html",
        splash_image_url="https://cdn.example.com/splash.png",
        splash_background_color="#101010",
        description="My first hyperframe",
    )
    base.update(overrides)
    return FrameMetadata(**base)


def test_frame_payload_uses_v2_schema():
    payload = _meta().to_frame_payload()
    assert payload["version"] == "next"
    assert payload["imageUrl"] == "https://cdn.example.com/clip.jpg"
    assert payload["button"]["title"] == "Play"

    action = payload["button"]["action"]
    assert action["type"] == "launch_frame"
    assert action["url"] == "https://cdn.example.com/clip.html"
    assert action["splashImageUrl"] == "https://cdn.example.com/splash.png"
    assert action["splashBackgroundColor"] == "#101010"


def test_frame_payload_falls_back_to_video_url_when_target_missing():
    payload = _meta(target_url=None, splash_image_url=None).to_frame_payload()
    assert payload["button"]["action"]["url"] == "https://cdn.example.com/clip.mp4"
    assert "splashImageUrl" not in payload["button"]["action"]


def test_render_html_embeds_meta_tags(tmp_path: Path):
    builder = HyperframeBuilder(metadata=_meta())
    html = builder.render_html()
    assert 'name="fc:frame"' in html
    assert 'name="fc:frame:video"' in html
    assert 'property="og:video"' in html
    assert "https://cdn.example.com/clip.mp4" in html
    assert "<title>Demo clip</title>" in html


def test_render_html_escapes_user_strings():
    builder = HyperframeBuilder(metadata=_meta(title='Evil " <script>'))
    html = builder.render_html()
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_write_html_and_manifest_roundtrip(tmp_path: Path):
    builder = HyperframeBuilder(metadata=_meta())
    html_path = builder.write_html(tmp_path / "frame.html")
    manifest_path = builder.write_manifest(tmp_path / "frame.json")

    assert html_path.exists()
    payload = json.loads(manifest_path.read_text())
    assert payload["button"]["action"]["url"] == "https://cdn.example.com/clip.html"
