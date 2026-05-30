# video-studio · HeyGen HyperFrames

โปรเจกต์ตัดต่อคลิปแบบเขียน HTML แล้ว render เป็น MP4 ด้วย [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)

ไทม์ไลน์ 30 วินาที (1920×1080 @ 30fps):

| ช่วงเวลา | ฉาก | เอฟเฟกต์ |
| --- | --- | --- |
| 0–3s | Intro title card | title slide-up, accent rule scale-in, subtitle fade-up, fade-out |
| 3–24s | Main clip (`assets/clip.mp4`) | color grade, vignette, film grain overlay |
| 6–14s | Lower-third caption | slide-in left, hold, slide-out left |
| 23.6–24s | Whip-pan | clip scale + lift |
| 24–24.4s | Flash cut | white flash transition |
| 24–29s | Outro card | title/rule/subtitle stagger |
| 29–30s | Fade to black | full-screen overlay |

## ติดตั้ง

ต้องมี Node.js 22+ และ FFmpeg

```bash
cd video-studio
npm install
npm run demo:clip   # สร้าง assets/clip.mp4 จาก ffmpeg testsrc (ใช้แทนเทสอย่างเดียว)
```

จะใช้คลิปจริง: copy/รีเอนโค้ดมาทับ `assets/clip.mp4` (ใช้คำสั่งใน `demo:clip` เป็นต้นแบบเรื่อง keyframe — `-g 30 -keyint_min 30 -movflags +faststart` ทำให้ HyperFrames seek แม่น)

## ใช้งาน

```bash
npm run dev        # preview ใน browser พร้อม live reload
npm run check      # lint + validate + inspect
npm run render     # render เป็น MP4 ใน renders/
npm run publish    # publish ขึ้น HyperFrames cloud (ออปชัน)
```

## ปรับแต่งจาก CLI

ใช้ `--variables` ของ HyperFrames เพื่อ override ตัวแปรของคอมโพสิชันโดยไม่ต้องแก้ HTML

```bash
npx --yes hyperframes@0.6.61 render --variables '{
  "clipSrc": "assets/myclip.mp4",
  "clipStart": 4.5,
  "clipDuration": 18,
  "introTitle": "EP. 07",
  "introSubtitle": "Night drive",
  "caption": "Tokyo · Shibuya",
  "outroTitle": "@SPNpeet",
  "outroSubtitle": "next: behind the scenes",
  "accent": "#ff4d6d"
}'
```

ตัวแปรทั้งหมดประกาศไว้ที่ `<html data-composition-variables="...">` ใน `index.html`

## ส่วนประกอบ

```
video-studio/
├── index.html              # คอมโพสิชันหลัก (timeline 30s)
├── assets/
│   ├── vendor/gsap.min.js  # GSAP bundle (ไม่ใช่ CDN เพื่อ deterministic)
│   └── clip.mp4            # คลิปอินพุต (gitignored, สร้างจาก demo:clip หรือ drop เอง)
├── hyperframes.json
├── meta.json
└── package.json
```

## เพิ่มเอฟเฟกต์/บล็อกใหม่

ดูคาตาล็อกบล็อกที่ใช้สั่ง `hyperframes add <name>` ได้ผ่านสกิล `/hyperframes-registry` (เช่น `glitch`, `cinematic-zoom`, `light-leak`, `caption-neon-glow`, `vfx-portal`)

```bash
npx --yes hyperframes@0.6.61 add glitch
```

แล้วอ้างไปใน `index.html` ผ่าน `data-composition-src="compositions/glitch.html"`
