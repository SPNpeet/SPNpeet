# video-studio

> Web UI + ffmpeg pipeline ที่เอาคลิปยาวมาตัดให้สั้น ใส่เอฟเฟกต์แบบไวรัล และ render เป็น MP4 พร้อมลง TikTok / IG Reels / YouTube Shorts

## คุณสมบัติ (เทคนิคที่ใช้จริงในคลิปไวรัลปี 2026)

### การตัดต่อ
- **Smart segment selection** — กระจาย segment ทั่วคลิปต้นฉบับ (ไม่ตัดแค่ตอนต้น) snap เข้าหา scene change อัตโนมัติ
- **Scene detection** ผ่าน `select='gt(scene,0.35)'` — หาจุดตัดธรรมชาติ
- **Silence detection** ผ่าน `silencedetect=noise=-32dB:d=0.45` — หลบเสียงเงียบ
- **Center-crop อัจฉริยะ** — landscape → vertical ก็จับกลางภาพให้

### ภาพ
- **Color grade** — `eq` (gamma + saturation + contrast) + `unsharp` mask + `noise` film grain + `vignette`
- **Punch-in zoom** ที่ hook (0–4 วินาทีแรก) เพิ่ม 8% ค่อยๆ ซูมเข้าด้วย `zoompan`
- **Progress bar** ใต้คลิป — แถบสีไหลตามเวลา ดัน retention
- **Cinematic fade** ที่หัว/ท้ายคลิป

### ตัวอักษร
- **Hook overlay** ตัวใหญ่ + กรอบสี + drop shadow โผล่ใน 0.15s แรก ค้าง 4s
- **CTA overlay** ตัวใหญ่ในวินาที 5 สุดท้าย
- **Auto captions ผ่าน Whisper.cpp** — ถอดเสียงคำต่อคำ → ASS subtitle แบบ CapCut/Submagic (คำที่กำลังพูดเด่นเหลือง + ขนาดใหญ่ขึ้น 15%)
- รองรับ 50+ ภาษา (ไทย / อังกฤษ / ญี่ปุ่น / เกาหลี / จีน / สเปน ฯลฯ) auto-detect ได้

### เสียง
- **Whoosh transition SFX** สังเคราะห์ใน ffmpeg ผ่าน `anoisesrc` + `bandpass` + envelope ใส่ทุกจุดตัดต่อ
- **Impact hit** บน hook reveal
- **Audio EQ** — bass warmth (+2.5dB ที่ 80Hz) + vocal presence (+1.5dB ที่ 3kHz)
- **Dynamic range** — `dynaudnorm` smooth ความดัง
- **Loudness norm** — `loudnorm I=-14:TP=-1.5:LRA=11` ตรง spec TikTok/IG/YouTube
- **True-peak limiter** กัน clipping หลัง platform transcode

### Encoding
- H.264 high profile, level 4.1, CRF 18, preset fast
- AAC 192k @ 44.1kHz
- `yuv420p` + `+faststart` เปิดได้บนทุกแพลตฟอร์ม

---

## ติดตั้ง

ต้องมี **Node.js 22+**, **ffmpeg**, **cmake**, **gcc**

```bash
cd video-studio
npm install
npm run install:whisper   # สร้าง whisper.cpp + ดาวน์โหลด base model (~150MB, ครั้งเดียว)
npm run web               # bind 0.0.0.0 — เข้าจากเครื่องไหนใน LAN ก็ได้
```

ถ้าข้าม `npm run install:whisper` ระบบจะทำงานปกติ แค่ไม่มี auto-captions

---

## เข้าใช้งานจากมือถือ

### 🌍 ออนไลน์ตลอด — deploy ขึ้น cloud (1 คำสั่ง)

ดู `DEPLOY.md` สำหรับวิธีเต็ม สรุปย่อ:

```bash
# Fly.io (ฟรี 3GB / 1GB RAM)
curl -L https://fly.io/install.sh | sh
fly auth signup
fly launch --copy-config --no-deploy
fly volumes create data    --size 1  --region sin --yes
fly volumes create renders --size 10 --region sin --yes
fly deploy
```

เสร็จแล้วได้ HTTPS URL `https://video-studio-xxx.fly.dev` เปิดบนมือถือไหนก็ได้ — Add to Home Screen ติดตั้งเป็นแอปจริง

อีก 2 ทาง:
- **Self-host บน VPS** $5/mo `docker compose up -d --build` + Caddy/Nginx ทำ HTTPS
- **Self-host บน NAS/PC ที่บ้าน** + `cloudflared tunnel --url http://localhost:8080` แชร์ออกอินเทอร์เน็ตชั่วคราว

### 🏠 LAN (เร็วที่สุดสำหรับลองเล่น)

รัน `npm run web` แล้วดูที่ **terminal** — มันจะโชว์ IP จริงของเครื่องคุณ:

```
  💻  http://localhost:4321
  📱  http://192.168.x.y:4321    ← IP จริงของเครื่องคุณ (ไม่ใช่ 192.168.1.42!)

  scan with your phone camera:
  [QR code]
```

มือถือต้อง **เชื่อม wifi เดียวกัน** กับเครื่องที่รัน server แล้วสแกน QR ในเทอร์มินัล
หากไม่เจอ IP `📱` ในเทอร์มินัล แสดงว่าเครื่องไม่มี LAN interface — ใช้ cloud หรือ tunnel แทน

---

## ฟีเจอร์ mobile-first

- **Responsive layout** — single column บนมือถือ, two column บน desktop ≥880px
- **Touch targets** ≥48px ทุกปุ่ม/input ตาม WCAG
- **Safe-area insets** สำหรับ iPhone notch + home indicator
- **PWA installable** — manifest + icons 192/512/180 + service worker (cache shell)
- **Web Share API** — กดปุ่ม Share แล้วใช้ share sheet ของระบบส่ง MP4 ไป TikTok/IG/Line ได้ตรงๆ
- **Haptic feedback** — สั่นเบาๆ ตอนเลือกไฟล์ + ตอน render เสร็จ
- **input modes** ที่เหมาะกับ mobile keyboard (autocapitalize)
- **Visible slider fill** ทุก browser (Chrome/Safari/Firefox)
- **Status bar themed** ตามสีพื้นหลัง app บนทั้ง iOS/Android

---

## ใช้งาน

1. **เลือก platform** — TikTok/Reels (9:16) หรือ YouTube (16:9)
2. **อัปโหลดคลิป** — แตะหรือลากวางได้ สูงสุด 500MB
3. **เลือกความยาว** — slider 15s ถึง 10 นาที
4. **ใส่ Hook / CTA** + เลือกสีไฮไลต์
5. **เปิด/ปิดเอฟเฟกต์** — auto caption, punch-in zoom, SFX, progress bar
6. กด **Render** → ดู progress live → preview + download MP4 + Share

---

## ขั้นตอน pipeline (ภายใน)

```
upload.mp4
   ↓
[ probe ]                       — ffprobe (duration / size / audio)
   ↓
[ detectScenes ][ detectSilences ]   — parallel
   ↓
[ chooseSegments ]               — snap to nearest scene boundary
   ↓
[ generateCaptions ][ makeWhoosh ][ makeImpact ]   — parallel
   ↓                                   ↑
   whisper-cli on per-segment .wav     ffmpeg lavfi
   → ASS subtitle (kinetic karaoke)
   ↓
[ build filter_complex ]
   trim → crop → scale → grade
   → zoompan (hook) → fade
   → concat → progress overlay
   → hook drawtext → cta drawtext
   → subtitles burn-in
   ↓
[ build audio chain ]
   atrim per seg → concat → dynaudnorm → EQ
   → loudnorm -14LUFS → SFX adelay+amix → alimiter
   ↓
[ ffmpeg encode ]
   libx264 CRF18 + AAC 192k + faststart
   ↓
out.mp4   ← พร้อมโพสต์
```

## โครงสร้างไฟล์

```
video-studio/
├── pipeline/
│   ├── auto_edit.js      # orchestrator + filter_complex builder
│   ├── analyze.js        # probe / silence / scene / loudness measurement
│   ├── segments.js       # smart segment selection
│   ├── captions.js       # whisper.cpp → ASS karaoke subtitle
│   └── sfx.js            # whoosh + impact sound synthesis
├── web/
│   ├── server.js         # Express + Multer + job queue
│   └── public/           # หน้าเว็บฟอร์ม + JS progress polling
├── scripts/
│   └── install-whisper.sh
├── vendor/whisper/       # whisper-cli + libs + model (gitignored)
├── assets/
│   ├── clip.mp4          # ทดลอง (gitignored)
│   └── _uploads/         # temp uploads (gitignored)
└── renders/              # output MP4 (gitignored)
```
