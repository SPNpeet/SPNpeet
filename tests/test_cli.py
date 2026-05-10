import json
from pathlib import Path

import pytest

from hyperframe_video import cli


@pytest.fixture
def fake_source(tmp_path: Path) -> Path:
    path = tmp_path / "in.mp4"
    path.write_bytes(b"\x00")
    return path


def test_cli_skip_render_writes_frame_assets(fake_source: Path, tmp_path: Path, monkeypatch):
    out_dir = tmp_path / "dist"
    monkeypatch.setattr(
        "hyperframe_video.cli.VideoEditor.thumbnail",
        lambda self, output, at=0.5: Path(output).write_bytes(b"img") or Path(output),
    )

    code = cli.main(
        [
            str(fake_source),
            "--out-dir",
            str(out_dir),
            "--name",
            "promo",
            "--title",
            "Promo",
            "--description",
            "A promo clip",
            "--button-title",
            "Watch now",
            "--base-url",
            "https://cdn.example.com/clips",
            "--skip-render",
        ]
    )

    assert code == 0
    html = (out_dir / "promo.html").read_text()
    assert "https://cdn.example.com/clips/promo.mp4" in html
    assert "Watch now" in html

    manifest = json.loads((out_dir / "promo.frame.json").read_text())
    assert manifest["version"] == "next"
    assert manifest["button"]["action"]["url"].endswith("promo.html")
