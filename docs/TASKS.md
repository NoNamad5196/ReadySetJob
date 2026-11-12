# ReadySetJob 단계별 작업 목록 및 진행 상태 (TASKS)

본 문서는 **ReadySetJob** 프로젝트의 단계별(P0~P4 및 디자인 트랙) 작업 항목, 완료 기준(Definition of Done), 현재 상태를 관리한다.

## 1. 상태 표기 원칙 (Status Honesty)

> **핵심 원칙: "문서 작성 완료 ≠ 기능 완료"**
> - 명세서나 설계 문서에 기능이 기술되었다고 해서 구현된 것으로 간주하지 않는다.
> - 코드가 작성되었더라도 실제로 실행·테스트하지 않은 항목은 `검증 완료`로 표기하지 않는다.

| 상태 값 | 정의 및 판정 기준 |
|---|---|
| `계획` | 요구사항 및 DB 스키마만 정의되었으며, 라우터·서비스·뷰 코드가 아직 작성되지 않은 상태 |
| `개발 중` | 현재 코드 또는 문서를 작성·수정하고 있거나 사용자 검토/승인을 대기 중인 상태 |
| `구현 완료` | 코드 또는 산출물 작성이 완료되었으나 자동화 테스트나 최종 승인 절차가 남아 있는 상태 |
| `검증 완료` | 실제 실행 및 `node --test` (`supertest`) 자동화 테스트를 통과하여 동작이 입증된 상태 |

## 2. 주요 마감 일정 (Milestones)

| 마감일 | 산출물 | 상태 |
|---|---|---|
| **2026-11-16** | 프로젝트 계획서 제출 (`docs/PROJECT_PROPOSAL.md`) | `개발 중` (초안 작성 및 검토 중) |
| **2026-12-16** | 기말 최종 발표 및 최종 보고서 제출 (`docs/FINAL_REPORT.md`) | `계획` |

---

## 3. 단계별 작업 체크리스트 (Phases P0 ~ P4)

### Phase P0. 프로젝트 기반 구축, 인증 및 핵심 CRUD

**P0 완료 기준 (Completion Criteria):**
1. Node.js 22 + Express 4 + EJS + `better-sqlite3` 프로젝트 구조가 초기화되고 `npm run migrate`, `npm run seed`, `npm test`가 오류 없이 실행된다.
2. 12개 도메인 테이블과 14개 인덱스를 포함한 `src/db/schema.sql`이 적용되고 한국어 데모 데이터(`demo@readysetjob.dev`)가 시드된다.
3. 세션 기반 회원가입·로그인·로그아웃, `requireAuth` 보호, `crypto.timingSafeEqual` 기반 CSRF 검증이 동작한다.
4. 기업(`companies`), 채용 공고(`job_posts`), 지원 현황(`applications` + `stage_logs`), 일정(`events`) CRUD와 사용자별 소유권 격리(`user_id = ?`, 타인 리소스 접근 시 `404`)가 `supertest` 통합 테스트를 통과한다.
5. `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DB_DESIGN.md`, `docs/TASKS.md` 기술 문서와 `docs/PROJECT_PROPOSAL.md` 계획서가 코드와 일치하게 작성된다.

| 구분 | 작업 항목 | 관련 파일 / 근거 | 상태 |
|---|---|---|---|
| P0-01 | Git 저장소 초기화 및 GitHub 원격 저장소 연결 | `.git/config`, `main` 브랜치 | `검증 완료` |
| P0-02 | Express 4 앱 팩토리(`createApp`), `helmet` CSP, SQLite 세션 스토어 초기화 | `package.json`, `src/app.js`, `src/server.js` | `검증 완료` |
| P0-03 | SQLite 연결(`WAL`, `foreign_keys = ON`), 12개 테이블 스키마 및 마이그레이션 구현 | `src/db/connection.js`, `src/db/schema.sql`, `src/db/migrate.js` | `구현 완료` |
| P0-04 | 기술 설계 문서 4종 (`SPEC.md`, `ARCHITECTURE.md`, `DB_DESIGN.md`, `TASKS.md`) 작성 | `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DB_DESIGN.md`, `docs/TASKS.md` | `구현 완료` |
| P0-05 | 한국어 데모 데이터 시드 스크립트 (`네이버`, `카카오`, `토스` 등 6개 기업·공고·지원·일정) | `src/db/seed.js`, `test/ownership-and-seed.test.js` | `검증 완료` |
| P0-06 | 회원가입·로그인·로그아웃, `bcryptjs` 해싱, 세션 재생성, `requireAuth`, CSRF 미들웨어 | `src/middleware/auth.js`, `src/middleware/csrf.js`, `src/routes/auth.js`, `test/auth-and-security.test.js` | `검증 완료` |
| P0-07 | 기업 관리 CRUD, 채용 공고 CRUD(인라인 기업 생성·북마크 토글·D-Day), 지원 현황 CRUD(`stage_logs`), 일정 CRUD 및 소유권 격리(`404`) | `src/routes/{companies,jobs,applications,events,dashboard}.js`, `src/services/*.js`, `test/crud-and-ownership.test.js`, `test/ownership-and-seed.test.js` | `검증 완료` |
| P0-08 | 프로젝트 계획서 (`docs/PROJECT_PROPOSAL.md`, 2026-11-16 제출용) 작성 | `docs/PROJECT_PROPOSAL.md` | `구현 완료` (초안 완성, 사용자 검토 대기) |

---

### Design Track. UI 레퍼런스 분석 및 디자인 시안 (A/B/C)

**디자인 트랙 완료 기준 (Completion Criteria):**
1. 외부 레퍼런스 분석(`docs/DESIGN_REFERENCES.md`)을 바탕으로 정적 HTML 시안 A/B/C(`design/mockups/`)와 스크린샷을 제작한다.
2. 사용자가 시안을 비교·선택하여 최종 승인하기 전까지 임의로 디자인을 확정하지 않는다.
3. 사용자 승인 후 `docs/DESIGN_SYSTEM.md`와 `public/css/tokens.css`를 확정한다.

| 구분 | 작업 항목 | 관련 파일 / 근거 | 상태 |
|---|---|---|---|
| DSN-01 | UI/UX 레퍼런스 조사 및 분석 문서화 | `docs/DESIGN_REFERENCES.md`, `docs/RESEARCH_NOTES.md` | `구현 완료` |
| DSN-02 | 기본 디자인 토큰(`tokens.css`) 및 라이트/다크 모드 변수 스캐폴딩 | `public/css/tokens.css`, `public/css/app.css`, `public/js/app.js` | `구현 완료` |
| DSN-03 | 정적 HTML 디자인 시안 A/B/C (대시보드, 칸반 보드, 자소서 에디터) 제작 및 스크린샷 캡처 | `design/mockups/`, `design/mockups/screenshot.mjs` | `구현 완료` |
| DSN-04 | 사용자 시안 검토 및 최종 디자인 승인 | 사용자 피드백 대기 | `개발 중` (사용자 승인 대기) |
| DSN-05 | 승인된 시안 기반 디자인 시스템 문서(`docs/DESIGN_SYSTEM.md`) 확정 | `docs/DESIGN_SYSTEM.md` | `계획` |

---

### Phase P1. 칸반 보드 및 자기소개서 버전 관리 시스템

**P1 완료 기준 (Completion Criteria):**
1. `GET /applications/board`에서 6개 전형 단계별 칸반 컬럼과 카드가 렌더링되고, `PATCH /api/applications/:id/stage` (`{ stage, result?, index? }`)를 통해 단계 이동·순서 재정렬·`stage_logs` 기록이 동작한다.
2. `/essays`에서 자기소개서 생성·조회·문항별 글자수 카운터 편집기가 동작하고, `PUT /api/essays/:id/draft`로 버전 생성 없이 작업 초안을 저장할 수 있다.
3. `POST /essays/:id/versions`로 불변 스냅샷(`version_no = max + 1`)을 생성하고, `GET /essays/:id/compare?from&to`에서 서버 사이드 `jsdiff` 단어 단위 비교(HTML 이스케이프 적용)가 렌더링된다.
4. `POST /essays/:id/versions/:no/restore` 복원 시 미저장 변경분 자동 백업 후 초안 덮어쓰기 및 `restored_from_version_id`가 기록된 신규 버전이 생성된다.
5. `GET /api/essays/search` 키워드 검색 및 자기소개서-자료함(`essay_materials`) 연결/해제가 통합 테스트로 검증된다.

| 구분 | 작업 항목 | 관련 파일 / 경로 (계획된 명세) | 상태 |
|---|---|---|---|
| P1-01 | 칸반 보드 화면 (`GET /applications/board`) 및 단계별 카드 렌더링 | `src/routes/applications.js`, `views/applications/board.ejs` | `검증 완료` |
| P1-02 | 칸반 카드 단계 이동 및 컬럼 내 `index`(`board_order`) 재정렬 API (`PATCH /api/applications/:id/stage`) | `src/routes/applications.js`, `src/services/applicationsService.js` | `검증 완료` |
| P1-03 | 자기소개서 목록·생성·멀티 문항 에디터 (`GET/POST /essays`, `GET /essays/:id`) | `src/routes/essays.js`, `src/services/essaysService.js`, `views/essays/*` | `검증 완료` |
| P1-04 | 자기소개서 작업 초안 저장 API (`PUT /api/essays/:id/draft`, 버전 미생성) | `src/routes/essays.js`, `src/services/essaysService.js` | `검증 완료` |
| P1-05 | 불변 버전 스냅샷 생성 및 조회 (`POST /essays/:id/versions`, `GET /essays/:id/versions`, `GET /essays/:id/versions/:no`) | `src/routes/essays.js`, `src/services/essaysService.js` | `검증 완료` |
| P1-06 | 서버 사이드 `jsdiff` 단어 단위 버전 비교 (`GET /essays/:id/compare?from&to`) | `src/routes/essays.js`, `views/essays/compare.ejs` | `검증 완료` |
| P1-07 | 이력 보존형 버전 복원 (`POST /essays/:id/versions/:no/restore`) | `src/routes/essays.js`, `src/services/essaysService.js` | `검증 완료` |
| P1-08 | 과거 자기소개서 문항·답변 검색 API (`GET /api/essays/search`) 및 자료함 연결/해제 (`essay_materials`) | `src/routes/essays.js`, `src/services/essaysService.js` | `검증 완료` |
| P1-09 | P1 칸반 및 자기소개서 버전·Diff·복원·소유권 격리 자동화 테스트 | `test/` | `검증 완료` |

---

### Phase P2. 대시보드 시각화, 경험 자료함 CRUD 및 검색 고도화

**P2 완료 기준 (Completion Criteria):**
1. Chart.js를 npm으로 설치하고 `/vendor/chart.js` 정적 라우트로 서빙하여(CDN 미사용) 대시보드에 전형 단계별·결과별 차트를 표시한다.
2. 대시보드에 마감 임박 공고(D-7) 및 다가오는 전형 일정 위젯을 연동한다.
3. 경험 자료함(`/materials`) CRUD 및 분류(`kind`)·태그 검색을 구현하고 테스트로 검증한다.

| 구분 | 작업 항목 | 관련 파일 / 경로 | 상태 |
|---|---|---|---|
| P2-01 | Chart.js 로컬 정적 서빙(`/vendor`) 및 대시보드 단계별·결과별 차트 구현 | `src/app.js`, `src/routes/dashboard.js`, `views/dashboard/index.ejs` | `검증 완료` |
| P2-02 | 대시보드 D-7 마감 임박 공고 및 다가오는 일정 요약 위젯 | `src/services/usersService.js`, `views/dashboard/index.ejs` | `검증 완료` |
| P2-03 | 경험 자료함(`materials`) CRUD 라우터·서비스·뷰 및 태그 필터링 | `src/routes/materials.js`, `src/services/materialsService.js`, `views/materials/*` | `검증 완료` |
| P2-04 | P2 대시보드 및 자료함 통합 테스트 작성 및 검증 | `test/crud-and-ownership.test.js` | `검증 완료` |

---

### Phase P3. 디자인 시스템 반영, 반응형·접근성 및 UX 폴리싱

**P3 완료 기준 (Completion Criteria):**
1. 사용자 승인된 Figma 대시보드 디자인 및 디자인 시스템(`docs/DESIGN_SYSTEM.md`)을 전체 EJS 뷰와 CSS 토큰에 일관되게 반영한다.
2. Pretendard Variable 폰트를 로컬 정적 서빙(`/vendor/pretendard`)하고, 3D 일러스트 제거, 블루 과용 축소, 이니셜 아바타, 실제 날짜 기반 데모 데이터를 적용한다.
3. 엄격한 CSP 정책(`default-src 'self'`)을 준수하여 뷰 템플릿 전역에서 인라인 `style=""` 0건을 달성한다.
4. 라이트/다크 모드(`data-theme`), 키보드 포커스 이동, 빈 상태(Empty State) 및 에러 페이지 UX를 완성한다.

| 구분 | 작업 항목 | 관련 파일 / 경로 | 상태 |
|---|---|---|---|
| P3-01 | Figma 승인 디자인 시스템(`docs/DESIGN_SYSTEM.md`, `tokens.css`, `app.css`, `pages.css`, `board.css`, `essay.css`, `ai.css`) 전 화면 적용 | `public/css/*`, `views/**/*.ejs` | `검증 완료` |
| P3-02 | 엄격한 CSP 준수: `views/` 내 인라인 `style=""` 0건 달성 및 동적 바 너비 `data-progress` 전환 | `views/**/*.ejs`, `public/js/app.js` | `검증 완료` |
| P3-03 | 다크 모드(`data-theme="dark"`), Pretendard 로컬 서빙, 반응형 네비게이션 및 에러 뷰 고도화 | `public/css/tokens.css`, `views/layouts/main.ejs`, `views/error.ejs` | `검증 완료` |
| P3-04 | 전체 기능 회귀 테스트 및 시각적 검증 통과 | `test/`, Playwright 헤드리스 검증 | `검증 완료` |

---

### Phase P4. OpenAI Responses API 연동 AI 4종 기능 및 시스템 완성

**P4 완료 기준 (Completion Criteria):**
1. 기존 면접 질문 생성을 포함하여 총 4종의 실용적 AI 기능을 OpenAI Responses API(Structured Outputs) 기반으로 완성한다:
   - 기능 1: 지원 공고·자소서 연계 면접 예상 질문 생성 (`POST /applications/:id/interview-questions/generate`, `OPENAI_MODEL_INTERVIEW || 'gpt-6.1-terra'`)
   - 기능 2: 자기소개서 문항 실시간 AI 첨삭 피드백 (`POST/GET /api/essays/:id/questions/:qid/feedback`, `OPENAI_MODEL_FEEDBACK || 'gpt-6.1-terra'`, `essay_feedback` 영속화)
   - 기능 3: 경험 소재 기반 AI STAR 초안 생성 및 본문 반영 (`POST /api/materials/:id/star-draft`, `POST /materials/:id/star-draft/:draftId/apply`, `OPENAI_MODEL_DRAFT || 'gpt-6.1-terra'`, `material_star_drafts` 영속화)
   - 기능 4: 복사한 채용 공고 텍스트 자동 파싱 및 폼 채우기 (`POST /api/jobs/parse`, `OPENAI_MODEL_EXTRACT || 'gpt-6-luna'`, DB 미저장 폼 자동 완성)
2. `OPENAI_API_KEY` 미설정 시 안전한 비활성화(`503`, 가짜 응답 없음), 4개 기능 통합 슬라이딩 윈도우 속도 제한(사용자당 10분 20회), 전역 및 기능별 모델 환경 변수 오버라이드를 지원한다.
3. API 키는 서버 `.env`로만 관리하며 브라우저·응답·로그에 절대 노출하지 않는다 (`GET /settings/ai` 포함).
4. 자동화 테스트 15개 스위트, 66개 테스트 전체 100% 통과(`npm test`).

| 구분 | 작업 항목 | 관련 파일 / 경로 | 상태 |
|---|---|---|---|
| P4-01 | OpenAI Responses API 클라이언트, 모델 환경 변수, 에러 매핑, 통합 속도 제한 모듈 구현 | `src/services/aiService.js`, `src/services/aiSchemas.js` | `검증 완료` |
| P4-02 | AI 4종 기능 라우터 및 영속화 서비스 구현 (`interview-questions`, `essay_feedback`, `material_star_drafts`, `jobs/parse`) | `src/routes/ai.js`, `src/services/aiFeaturesService.js` | `검증 완료` |
| P4-03 | AI 전용 EJS 파셜 4종 및 CSS/JS 프론트엔드 모듈 구현 | `views/partials/ai/*`, `public/css/ai.css`, `public/js/ai.js` | `검증 완료` |
| P4-04 | AI 비활성 상태(`503`), 권한/CSRF, 응답 검증, 속도 제한, 모델 오버라이드 자동화 테스트 | `test/ai-features.test.js`, `test/ai-errors-and-limits.test.js` | `검증 완료` |
| P4-05 | 전체 66개 통합 테스트 검증 및 기술 문서 갱신 | `npm test`, `docs/*.md`, `README.md` | `검증 완료` |
| P4-06 | 공고·지원·면접 단계 연동 일정·할 일 자동 정리 및 백그라운드 AI 면접 질문 자동 생성 | `src/services/automationService.js`, `test/automation.test.js` | `검증 완료` |
| P4-07 | 설정 화면 `users.auto_feedback` 옵션 및 자소서 버전 저장 시 백그라운드 자동 AI 피드백 | `src/routes/settings.js`, `src/routes/essays.js`, `test/auto-feedback.test.js` | `검증 완료` |
| P4-08 | OpenAI `web_search` 도구 기반 AI 공고 검색·추천 및 검증 문서화 (`OPENAI_MODEL_SEARCH || 'gpt-6.1-terra'`) | `GET /jobs/discover`, `POST /api/jobs/search`, `docs/AI_WEB_SEARCH_VERIFICATION.md`, `test/ai-search.test.js` | `검증 완료` |
| P4-09 | 대시보드 AI 주간 브리핑 생성, `ai_briefings` 일일 캐시(`force=1`), 내부 링크 allow-list (`OPENAI_MODEL_BRIEFING || 'gpt-6-luna'`) | `GET/POST /api/briefing`, `src/services/aiBriefingService.js`, `test/ai-briefing.test.js` | `검증 완료` |
| P4-10 | 파비콘·웹 앱 매니페스트 적용, Render 무료 배포(`AUTO_SEED=1`, `https://readysetjob.onrender.com`), 18개 스위트 89개 테스트 및 실호출 검증 | `public/favicon.*`, `public/site.webmanifest`, `render.yaml`, `test/` | `검증 완료` |

---

## 4. 변경 이력 (Changelog)

### 2026-11-12
- **일정·할 일·AI 질문 자동 정리 (`검증 완료`)**: `src/services/automationService.js`를 통해 공고 등록 시 `[회사명] 공고명 서류 마감` 일정(18:00) 자동 생성, 지원 등록 시 마감 일정 연결(없으면 생성) 및 `[회사명] 자기소개서 작성` 할 일 자동 생성, 1차/2차 면접 단계 전환 시(`PUT`, `PATCH` API, no-JS `POST` 3경로) 면접 준비 할 일 자동 생성 및 백그라운드 AI 면접 질문 자동 생성(기존 AI 질문 3개 미만 시, 공유 속도 제한 준수, 중복 생성 방지) 구현 (`test/automation.test.js` 6개 통과, 실호출 시 AI 질문 7개 자동 생성 확인).
- **자동 AI 피드백 옵션 (`검증 완료`)**: 설정 화면 체크박스 `users.auto_feedback`(기본 off, 호출 비용 안내) 활성화 시 자소서 버전 저장마다 답변이 있는 문항별로 백그라운드 AI 피드백(`essay_feedback`) 자동 생성·저장, 속도 제한 도달 시 중단 및 응답 무영향 처리 (`test/auto-feedback.test.js` 6개 통과, 실호출 3문항 약 29초 검증).
- **OpenAI `web_search` 기반 AI 공고 검색·추천 (`검증 완료`)**: `GET /jobs/discover`, `POST /api/jobs/search`에서 OpenAI Responses API 내장 `web_search` 도구(`tools: [{ type: "web_search" }]`, 한국 지역 힌트, `OPENAI_MODEL_SEARCH || 'gpt-6.1-terra'`)와 JSON 스키마 검증으로 최대 8건 추천, 유효한 `http`/`https` 출처 URL 필터링, 잘못된 마감일 `null` 처리, DB 자동 저장 없이 카드 내 "공고 등록" 버튼(`POST /jobs`) 연동 및 면책 문구 표시 (`test/ai-search.test.js` 7개 통과, 실호출 11초 3건 원티드 링크 HTTP 200 확인, `docs/AI_WEB_SEARCH_VERIFICATION.md`).
- **AI 주간 브리핑 및 일일 캐시 (`검증 완료`)**: 대시보드 상단 카드 및 `GET/POST /api/briefing`에서 본인 데이터(7일 내 마감·일정, 미완료 할 일, 단계별 진행 지원, 이번 달 목표)만 사용해 주간 브리핑 생성(`OPENAI_MODEL_BRIEFING || 'gpt-6-luna'`), `ai_briefings` 테이블(`UNIQUE(user_id, briefing_date)`) 하루 1회 캐시 및 `force=1` 새로고침, 내부 링크 allow-list 적용 (`test/ai-briefing.test.js` 4개 통과, 실호출 검증 완료).
- **파비콘·웹 앱 아이콘 및 Render 무료 배포 (`검증 완료`)**: `favicon.svg`/`.ico`, `apple-touch-icon`, `icon-192`/`512`, `site.webmanifest` 적용 및 Render 무료 배포(`https://readysetjob.onrender.com`, `AUTO_SEED=1` 빈 DB 데모 데이터 자동 시드, 재시작 시 초기화 한계 명시) 완료. 전체 18개 스위트 89개 테스트 전원 통과 및 인라인 `style` 0건 유지.

### 2026-11-11
- **Figma 승인 디자인 시스템 전면 적용 (`검증 완료`)**: 승인된 Figma 대시보드 디자인을 기반으로 `docs/DESIGN_SYSTEM.md`, `tokens.css`, `app.css`, `pages.css`, `board.css`, `essay.css`, `ai.css` 확정. 전체 EJS 뷰에 일관된 헤더, 사이드바, 통계 카드, 퍼널 테이블, 필터 칩 적용.
- **엄격한 CSP 준수 (`검증 완료`)**: `views/` 디렉터리 내 모든 인라인 `style=""` 속성을 0건으로 제거하고, 동적 바 너비는 `data-progress` 및 CSS 어트리뷰트 셀렉터로 처리하여 CSP 위반을 완벽 차단.
- **OpenAI Responses API 전환 및 AI 4종 기능 완성 (`검증 완료`)**: 기존 Gemini 연동을 OpenAI Responses API로 전면 전환하고, 면접 질문 생성(1) 외에 자소서 피드백(2), 경험 자료 STAR 초안(3), 공고 텍스트 자동 추출(4) 기능을 추가 구현 및 영속화(`essay_feedback`, `material_star_drafts`).
- **안전한 API 키 관리 및 비활성화 처리 (`검증 완료`)**: `OPENAI_API_KEY` 미설정 시 정직한 비활성화 안내 및 503 반환, 전역(`OPENAI_MODEL`) 및 기능별(`OPENAI_MODEL_*`) 모델 오버라이드 지원, 사용자당 10분 20회 통합 속도 제한 적용, `/settings/ai` 안내 화면 제공.
- **전체 자동화 테스트 66/66 100% 통과 (`검증 완료`)**: 인증, CRUD, 소유권 격리, 칸반 보드, 자소서 불변 버전/Diff/복원, 대시보드 통계, 자료함, 리뷰 수정 9건, 인터뷰 질문, 할일/설정, 통계/검색/홈, AI 4종 기능, AI 에러/제한 등 15개 스위트 66개 테스트 무결점 통과.
