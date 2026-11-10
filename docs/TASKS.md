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
| P0-08 | 프로젝트 계획서 (`docs/PROJECT_PROPOSAL.md`, 2026-11-16 제출용) 작성 | `docs/PROJECT_PROPOSAL.md` | `개발 중` |

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
| DSN-03 | 정적 HTML 디자인 시안 A/B/C (대시보드, 칸반 보드, 자소서 에디터) 제작 및 스크린샷 캡처 | `design/mockups/`, `design/mockups/screenshot.mjs` | `개발 중` |
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
| P1-01 | 칸반 보드 화면 (`GET /applications/board`) 및 단계별 카드 렌더링 | `src/routes/applications.js`, `views/applications/board.ejs` | `개발 중` |
| P1-02 | 칸반 카드 단계 이동 및 컬럼 내 `index`(`board_order`) 재정렬 API (`PATCH /api/applications/:id/stage`) | `src/routes/applications.js`, `src/services/applicationsService.js` | `개발 중` |
| P1-03 | 자기소개서 목록·생성·멀티 문항 에디터 (`GET/POST /essays`, `GET /essays/:id`) | `src/routes/essays.js`, `src/services/essaysService.js`, `views/essays/*` | `개발 중` |
| P1-04 | 자기소개서 작업 초안 저장 API (`PUT /api/essays/:id/draft`, 버전 미생성) | `src/routes/essays.js`, `src/services/essaysService.js` | `개발 중` |
| P1-05 | 불변 버전 스냅샷 생성 및 조회 (`POST /essays/:id/versions`, `GET /essays/:id/versions`, `GET /essays/:id/versions/:no`) | `src/routes/essays.js`, `src/services/essaysService.js` | `개발 중` |
| P1-06 | 서버 사이드 `jsdiff` 단어 단위 버전 비교 (`GET /essays/:id/compare?from&to`) | `src/routes/essays.js`, `views/essays/compare.ejs` | `개발 중` |
| P1-07 | 이력 보존형 버전 복원 (`POST /essays/:id/versions/:no/restore`) | `src/routes/essays.js`, `src/services/essaysService.js` | `개발 중` |
| P1-08 | 과거 자기소개서 문항·답변 검색 API (`GET /api/essays/search`) 및 자료함 연결/해제 (`essay_materials`) | `src/routes/essays.js`, `src/services/essaysService.js` | `개발 중` |
| P1-09 | P1 칸반 및 자기소개서 버전·Diff·복원·소유권 격리 자동화 테스트 | `test/` | `개발 중` |

---

### Phase P2. 대시보드 시각화, 경험 자료함 CRUD 및 검색 고도화

**P2 완료 기준 (Completion Criteria):**
1. Chart.js를 npm으로 설치하고 `/vendor` 정적 라우트로 서빙하여(CDN 미사용) 대시보드에 전형 단계별·결과별 차트를 표시한다.
2. 대시보드에 마감 임박 공고(D-7) 및 다가오는 전형 일정 위젯을 연동한다.
3. 경험 자료함(`/materials`) CRUD 및 분류(`kind`)·태그 검색을 구현하고 테스트로 검증한다.

| 구분 | 작업 항목 | 관련 파일 / 경로 | 상태 |
|---|---|---|---|
| P2-01 | Chart.js 로컬 정적 서빙(`/vendor`) 및 대시보드 단계별·결과별 차트 구현 | `src/app.js`, `src/routes/dashboard.js`, `views/dashboard/index.ejs` | `계획` |
| P2-02 | 대시보드 D-7 마감 임박 공고 및 다가오는 일정 요약 위젯 | `src/services/usersService.js`, `views/dashboard/index.ejs` | `계획` |
| P2-03 | 경험 자료함(`materials`) CRUD 라우터·서비스·뷰 및 태그 필터링 | `src/routes/materials.js`, `src/services/materialsService.js`, `views/materials/*` | `계획` |
| P2-04 | P2 대시보드 및 자료함 통합 테스트 작성 및 검증 | `test/` | `계획` |

---

### Phase P3. 디자인 시스템 반영, 반응형·접근성 및 UX 폴리싱

**P3 완료 기준 (Completion Criteria):**
1. 사용자 승인된 디자인 시안(`docs/DESIGN_SYSTEM.md`)을 전체 EJS 뷰와 CSS 토큰에 일관되게 반영한다.
2. 라이트/다크 모드 색상 대비, 키보드 포커스 이동, 모바일/태블릿 반응형 레이아웃, 빈 상태(Empty State) 및 에러 페이지 UX를 점검·완료한다.

| 구분 | 작업 항목 | 관련 파일 / 경로 | 상태 |
|---|---|---|---|
| P3-01 | 승인된 디자인 시스템(`docs/DESIGN_SYSTEM.md`) 전체 페이지 적용 | `public/css/tokens.css`, `public/css/app.css`, `views/**/*.ejs` | `계획` |
| P3-02 | 다크 모드(`data-theme="dark"`), 반응형 레이아웃, 키보드 접근성 검수 | `public/css/*`, `views/**/*.ejs` | `계획` |
| P3-03 | 전체 기능 회귀 테스트 및 시각적 QA 검증 | `test/` | `계획` |

---

### Phase P4. AI 면접 예상 질문 생성 및 최종 보고서

**P4 완료 기준 (Completion Criteria):**
1. `POST /applications/:id/interview-questions/generate`가 서버 사이드에서 Gemini API를 호출하여 지원 공고·자소서 기반 면접 예상 질문을 생성·저장한다.
2. `GEMINI_API_KEY` 미설정 환경에서는 AI 생성 버튼이 비활성화(`disabled`)되고 안내 문구가 표시되며 가짜 응답을 반환하지 않는다.
3. 기말 최종 보고서(`docs/FINAL_REPORT.md`)와 시연 시나리오(`README.md`)를 완성한다.

| 구분 | 작업 항목 | 관련 파일 / 경로 | 상태 |
|---|---|---|---|
| P4-01 | 서버 사이드 Gemini 면접 질문 생성 라우터·서비스 및 키 미설정 비활성 처리 | `src/routes/ai.js`, `src/services/aiService.js`, `views/applications/detail.ejs` | `계획` |
| P4-02 | 수동/AI 면접 질문 관리 및 테스트 검증 | `test/` | `계획` |
| P4-03 | 최종 보고서(`docs/FINAL_REPORT.md`, 2026-12-16 마감) 및 시연 가이드 완성 | `docs/FINAL_REPORT.md`, `README.md` | `계획` |

---

## 4. 변경 이력 (Changelog)

### 2026-11-10
- **저장소 및 스캐폴딩 구축 (`검증 완료`)**: Node.js 22 + Express 4 + EJS + `better-sqlite3` 프로젝트 초기화, GitHub 연결 완료.
- **데이터베이스 스키마 및 한국어 시드 구현 (`검증 완료`)**: `src/db/schema.sql`(12개 테이블, 14개 인덱스), `src/db/migrate.js`, `src/db/seed.js`(`demo@readysetjob.dev` 외 6개 기업·공고·지원·일정) 구현 및 테스트 통과.
- **인증·세션·보안 미들웨어 구현 (`검증 완료`)**: `bcryptjs` 비밀번호 해싱, 로그인/회원가입 시 세션 재생성(`req.session.regenerate`), `requireAuth`, `crypto.timingSafeEqual` CSRF 검증(`_csrf` 바디 및 `X-CSRF-Token` 헤더), `helmet` CSP 적용 및 `test/auth-and-security.test.js` 통과.
- **핵심 도메인 CRUD 및 소유권 격리 구현 (`검증 완료`)**: 기업(`/companies`), 채용 공고(`/jobs`, 인라인 기업 생성 트랜잭션 및 북마크 토글), 지원 현황(`/applications`, `/api/applications/:id/stage`, `stage_logs` 기록), 일정(`/events`), 대시보드 카운트(`/dashboard`) 구현 및 `test/crud-and-ownership.test.js`, `test/ownership-and-seed.test.js` 통과.
- **기술 문서 4종 작성 (`구현 완료`)**: 실제 코드 및 P1 계획 명세를 바탕으로 `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DB_DESIGN.md`, `docs/TASKS.md` 작성 완료.
- **진행 중 작업 (`개발 중`)**: `docs/PROJECT_PROPOSAL.md`(11/16 제출 계획서), 디자인 시안 A/B/C(`design/mockups/`), P1 칸반 보드 및 자기소개서 버전 관리 모듈 병행 개발 진행 중.
