import json
from dataclasses import dataclass, field
from html import escape
from pathlib import Path


FARCASTER_FRAME_VERSION = "next"


@dataclass
class FrameMetadata:
    title: str
    image_url: str
    video_url: str
    button_title: str = "Watch"
    target_url: str | None = None
    splash_image_url: str | None = None
    splash_background_color: str = "#000000"
    description: str = ""
    aspect_ratio: str = "1.91:1"

    def to_frame_payload(self) -> dict:
        action: dict = {
            "type": "launch_frame",
            "name": self.title,
            "url": self.target_url or self.video_url,
        }
        if self.splash_image_url:
            action["splashImageUrl"] = self.splash_image_url
        action["splashBackgroundColor"] = self.splash_background_color

        return {
            "version": FARCASTER_FRAME_VERSION,
            "imageUrl": self.image_url,
            "button": {
                "title": self.button_title,
                "action": action,
            },
        }


@dataclass
class HyperframeBuilder:
    metadata: FrameMetadata
    extra_meta: dict[str, str] = field(default_factory=dict)

    def render_html(self) -> str:
        frame_json = json.dumps(self.metadata.to_frame_payload(), separators=(",", ":"))
        frame_attr = escape(frame_json, quote=True)
        title = escape(self.metadata.title)
        description = escape(self.metadata.description or self.metadata.title)
        image = escape(self.metadata.image_url, quote=True)
        video = escape(self.metadata.video_url, quote=True)
        aspect = escape(self.metadata.aspect_ratio, quote=True)

        extras = "\n    ".join(
            f'<meta name="{escape(k, quote=True)}" content="{escape(v, quote=True)}" />'
            for k, v in self.extra_meta.items()
        )

        return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content="{description}" />

    <meta name="fc:frame" content="{frame_attr}" />
    <meta name="fc:frame:image" content="{image}" />
    <meta name="fc:frame:image:aspect_ratio" content="{aspect}" />
    <meta name="fc:frame:video" content="{video}" />
    <meta name="fc:frame:button:1" content="{escape(self.metadata.button_title, quote=True)}" />

    <meta property="og:title" content="{title}" />
    <meta property="og:description" content="{description}" />
    <meta property="og:image" content="{image}" />
    <meta property="og:video" content="{video}" />
    <meta property="og:video:type" content="video/mp4" />
    {extras}
  </head>
  <body>
    <main>
      <h1>{title}</h1>
      <video controls playsinline poster="{image}" style="max-width:100%">
        <source src="{video}" type="video/mp4" />
      </video>
      <p>{description}</p>
    </main>
  </body>
</html>
"""

    def write_html(self, output: Path) -> Path:
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(self.render_html(), encoding="utf-8")
        return output

    def write_manifest(self, output: Path) -> Path:
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(self.metadata.to_frame_payload(), indent=2),
            encoding="utf-8",
        )
        return output
