# Welcome to your Lovable project

# 🛡️ LogMind

**Intelligent Log Analysis Platform** — 로그 속에 숨겨진 장애의 맥락을, AI가 가장 먼저 읽어냅니다.

🚀 **Live Demo**: [https://logmind.lovable.app](https://logmind.lovable.app)

> 한양대학교 공학대학원 AI 의산업현장적용 중간고사 과제 · 2026.04
> 컴퓨터공학과 2026114194 오성호

---

## 📖 About

IT 미들웨어 엔지니어(JEUS · WebtoB · Tomcat · Apache)를 위한 AI 기반 로그 분석 플랫폼.
로그 파일을 업로드하면 AI가 **장애 원인 추론**, **조치 가이드 제시**, **재발방지 보고서 자동 생성**까지 수행합니다.

### Core Features

- **🧠 문맥 기반 장애 원인 추론** — 단순 키워드 매칭을 넘어 근본 원인 추론
- **💬 대화형 자연어 운영 인터페이스** — SQL/정규식 없이 자연어 질의
- **📄 보고서 자동화** — DOCX · PDF 형식으로 즉시 다운로드

---

## 🏗️ Tech Stack

| Layer | Tech |
|---|---|
| **Frontend** | React 18 · TypeScript · Vite · Tailwind · shadcn/ui |
| **Backend** | Supabase (Edge Functions + Postgres + pgvector) |
| **AI / ML** | Gemini 2.5 Flash · google/text-embedding-004 · Regex + LLM Hybrid Classifier |
| **Report** | docx · jspdf · jszip · file-saver |
| **Testing** | Vitest · Playwright 1.57 |

---

## 🚀 Getting Started

```bash
# Clone
git clone https://github.com/Fivestar1123/middleware-sage.git
cd middleware-sage

# Install
bun install   # 또는 npm install

# Env setup - .env 파일 생성
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_ANON_KEY=...

# Run
bun dev       # http://localhost:8080

# Test
bun test              # Unit (Vitest)
bunx playwright test  # E2E (Playwright)
```

---

## 📸 Preview

| Main Dashboard | AI Analysis |
|---|---|
| 로그 업로드 · 분석 이력 | 위험도 분포 · AI 원인 분석 |

실제 화면은 [logmind.lovable.app](https://logmind.lovable.app) 에서 확인 가능합니다.

---

## 🗺️ Roadmap (UX · 접근성 축)

- [ ] **C1. IDE · CLI 연동** — VSCode Extension, `logmind analyze` CLI (2~3주)
- [ ] **C2. 협업 봇 통합** — Slack / Teams Bot (2~4주)
- [x] **C3. 모바일 · PWA** — manifest.json · apple-touch-icon 세팅 완료
- [ ] **C4. WCAG 2.1 접근성** — 키보드 내비게이션 · 색맹 대응 (2~3주)

---

## 👤 Author

**오성호** — [@Fivestar1123](https://github.com/Fivestar1123) · ohsungho1123@gmail.com

---

<sub>**로그를 읽는 시간을, 서비스를 고치는 시간으로.**</sub>
