# hyperframe-video

ตัดต่อวิดีโอด้วย ffmpeg แล้วสร้าง Farcaster Hyperframe (Frames v2) สำหรับโพสต์บน Farcaster

## ติดตั้ง

ต้องมี `ffmpeg` และ `ffprobe` อยู่บน PATH ก่อน

```bash
pip install -e .[dev]
```

## ใช้งานผ่าน CLI

```bash
hyperframe-video input.mp4 \
  --out-dir dist \
  --name promo \
  --start 3 --end 18 \
  --width 1280 --fps 30 \
  --fade-in 0.5 --fade-out 0.5 \
  --overlay-text "New drop!" \
  --title "My new clip" \
  --description "Premiering on Farcaster" \
  --button-title "Watch" \
  --base-url https://cdn.example.com/clips/ \
  --splash-image https://cdn.example.com/clips/splash.png \
  --splash-color "#0b0b0b"
```

ผลลัพธ์ใน `dist/`:

| ไฟล์ | คำอธิบาย |
| --- | --- |
| `promo.mp4` | วิดีโอที่ตัดต่อแล้ว (H.264 + AAC, faststart) |
| `promo.jpg` | รูป poster สำหรับ frame |
| `promo.html` | หน้า Hyperframe ที่ฝัง meta tag `fc:frame` v2 |
| `promo.frame.json` | payload ของ frame ใช้ตรวจสอบเร็ว ๆ |

อัปโหลดไฟล์ทั้งหมดไปไว้ที่ `--base-url` แล้วโพสต์ลิงก์ของ `promo.html` บน Farcaster — client จะอ่าน meta tag แล้ว render เป็น Hyperframe พร้อมปุ่ม `Watch`

## ใช้งานในโค้ด

```python
from pathlib import Path
from hyperframe_video import VideoEditor, EditOptions, FrameMetadata, HyperframeBuilder

VideoEditor(Path("input.mp4")).render(
    Path("dist/promo.mp4"),
    EditOptions(start=3, end=18, width=1280, fade_in=0.5, fade_out=0.5),
)

frame = HyperframeBuilder(
    metadata=FrameMetadata(
        title="My new clip",
        image_url="https://cdn.example.com/clips/promo.jpg",
        video_url="https://cdn.example.com/clips/promo.mp4",
        target_url="https://cdn.example.com/clips/promo.html",
        button_title="Watch",
    ),
)
frame.write_html(Path("dist/promo.html"))
```

## Run tests

```bash
pytest
```
