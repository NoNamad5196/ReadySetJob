# ReadySetJob: 개발 일지 및 아이디어 로그 (IDEA_LOG)

> 💡 **문서 개요**: 본 문서는 ReadySetJob 프로젝트의 Notion 작업 허브와 동기화되는 로컬 개발 일지이자 백업 문서이다. 프로젝트 초기 아이디어 구체화 과정, 문서 구조 채택 이유, 일자별 개발 이력을 상세히 기록한다.

---

## 1. 문서 목적 및 Notion 연동 개요

본 문서는 원격 Notion 워크스페이스에 기록되는 프로젝트 허브와 하위 기술 문서들을 Git 저장소 내부에서 영구적으로 보존하기 위한 로컬 백업본이다. 네트워크 장애나 플랫폼 종속성에 구애받지 않고 개발 과정의 모든 의사결정과 문제 해결 기록을 로컬 마크다운 파일로 관리한다.

### 1.1 Notion 문서 링크 (동기화 완료)

* **ReadySetJob 메인 프로젝트 허브**: https://app.notion.com/p/4157cdef782d810bb5a1fcdde724f0ea
* **하위 문서 1 (시스템 아키텍처 및 DB 설계)**: https://app.notion.com/p/4157cdef782d818fad33ee862717e360
* **하위 문서 2 (UI/UX 디자인 및 레퍼런스)**: https://app.notion.com/p/4157cdef782d81d7a5a0ea2fdcc4ef33
* **하위 문서 3 (구현·테스트 및 문제 해결 기록)**: https://app.notion.com/p/4157cdef782d818ebeb3e0114039f4b9

---

## 2. 참고 문서 구조 및 채택 이유

ReadySetJob의 모든 기술 문서는 실무급 엔지니어링 포트폴리오(싼데비슷한, KUREND 등)의 표준 문서 템플릿 구조를 벤치마킹하여 설계되었다.

### 2.1 6단계 표준 문서 구조
1. **요약 콜아웃 (Summary Callout)**: 문서 서두에 1단락 핵심 개요와 현재 진행 상태를 명시하여 독자가 문서의 핵심 목적을 즉시 파악할 수 있도록 한다.
2. **목표 및 범위 (Goal & Scope)**: 과목 평가 기준과 프로젝트 경계를 명확히 정의하고 불필요한 범위 확장을 차단한다.
3. **기능별 요구사항 표 (Requirements Table)**: 모듈 ID, 상세 인수 조건, 우선순위, 구현 및 검증 상태를 표 형태로 표준화한다.
4. **기술적 결정과 이유 (Architecture & Decisions)**: 단순 기술 나열을 배제하고 "왜 이 기술과 모델을 선택했는가"에 대한 근거와 트레이드오프를 상세히 서술한다.
5. **검증 및 완료 조건 체크리스트 (Definition of Done)**: 정량적 통과 기준을 체크리스트로 제시하여 "문서 작성 완료 ≠ 기능 완료" 원칙을 준수한다.
6. **변경 이력 (Dated Changelog)**: 일자별 작업 내역과 상태 변화를 시간순으로 누적한다.

### 2.2 메인 허브와 하위 기술 문서 분리 구조 채택 이유
* **정보 밀도와 탐색성 분리**: 단일 거대 문서(Monolithic Doc)는 스크롤 압박이 심하고 전체 구조를 조망하기 어렵다. 메인 허브(`hub.md`)는 핵심 요약과 진행 현황만을 컴팩트하게 담고, 심층 기술 내역(아키텍처/DB, UI/UX 디자인, 트러블슈팅)은 하위 문서로 분리하여 독자가 관심 분야에 맞춰 선택적으로 열람할 수 있도록 설계했다.
* **Notion 하위 페이지 구조 최적화**: Notion의 페이지-하위 페이지 계층 구조와 1:1로 대응되어, 브라우징 및 유지보수가 직관적이다.
* **중복 없는 단일 진실 공급원(Single Source of Truth)**: 허브는 요약과 링크만 유지하고 세부 내용은 하위 문서에만 작성하여 문서 간 내용 불일치 문제를 원천 차단했다.

---

## 3. 2026-11-10 개발 진행 일지 (Dated Changelog)

* **09:00 ~ 11:30 | 프로젝트 초기화 및 데이터베이스 스키마 구축**:
  * Node.js 22 + Express 4 + EJS + `better-sqlite3` 기반의 프로젝트 구조를 초기화하고 Git 원격 저장소(`https://github.com/NoNamad5196/ReadySetJob`)에 연결 및 첫 푸시를 완료했다.
  * 12개 도메인 테이블(`users`, `companies`, `job_posts`, `applications`, `stage_logs`, `events`, `essays`, `essay_questions`, `essay_versions`, `materials`, `essay_materials`, `interview_questions`)과 14개 인덱스를 포함한 `src/db/schema.sql`을 작성하고 마이그레이션 스크립트를 구현했다.
  * 네이버, 카카오, 토스 등 실제 한국 IT 채용 공고와 지원 내역, 일정이 포함된 데모 데이터 시드 스크립트(`src/db/seed.js`)를 작성했다.
* **11:30 ~ 14:00 | 보안 미들웨어 및 P0 핵심 도메인 CRUD 구현**:
  * `bcryptjs` 해싱(cost 10) 기반의 회원가입, 로그인, 로그아웃 기능을 구현하고, 로그인 직후 세션 재생성(`req.session.regenerate()`)을 적용하여 세션 고정 공격을 차단했다.
  * `crypto.timingSafeEqual`을 활용한 상수 시간 CSRF 토큰 검증 미들웨어(`src/middleware/csrf.js`)를 구현하여 폼(`_csrf`)과 AJAX 헤더(`X-CSRF-Token`) 양쪽을 모두 지원하도록 했다.
  * 기업(`/companies`), 채용 공고(`/jobs`, 인라인 기업 생성 트랜잭션 및 북마크 토글), 지원 현황(`/applications`, 단계/결과 분리 및 `stage_logs` 자동 기록), 일정(`/events`), 대시보드 요약(`/dashboard`) 라우터와 서비스를 구현했다.
* **14:00 ~ 15:30 | 세션 타이머 버그 해결 및 자동화 테스트 10개 검증 통과**:
  * 테스트 실행 후 프로세스가 종료되지 않는 문제(Issue-01)를 발견했다. `better-sqlite3-session-store`의 `setInterval` 타이머에 `timer.unref()`를 호출하도록 커스텀 스토어 클래스를 구현하여 해결했다.
  * `test/auth-and-security.test.js` (4건), `test/crud-and-ownership.test.js` (4건), `test/ownership-and-seed.test.js` (2건) 등 총 10개 핵심 시나리오 테스트를 작성하고 전원 통과(`pass 10`, `fail 0`)를 달성했다.
* **15:30 ~ 17:30 | 경쟁 서비스 심층 조사 및 UI/UX 레퍼런스 분석 완료**:
  * Perplexity 도구를 활용하여 해외 구직 트래커(Huntr, Teal, Simplify), 국내 플랫폼(자소설닷컴, 잡코리아, 사람인, 링커리어, 캐치), 스프레드시트 수기 방식 등 9종의 기능을 객관적으로 조사하고 `docs/RESEARCH_NOTES.md`에 정리했다.
  * Linear, Huntr, Craft, Attio, Notion, Pretendard 글꼴 체계를 분석하여 ReadySetJob의 6대 통합 디자인 원칙(오프화이트 라이트 모드, 1px 테두리, 단일 액센트, Pretendard 고정폭 숫자, 단계/결과 분리, 불변 버전 비교)을 수립했다.
* **17:30 ~ 19:30 | 정적 HTML 디자인 시안 A/B/C 및 스크린샷 12장 제작**:
  * A안(Linear 미니멀 SaaS), B안(Huntr 채용 관리 중심), C안(Craft 문서 작업 중심)의 정적 HTML 목업 9종을 제작하고, 실제 브라우저에서 1440px 데스크톱 및 390px 모바일 스크린샷 12장을 캡처했다.
  * A안 칸반 보드 상세 드로어 오픈 시 가로 폭 협소 결함과 C안 에디터 본문 넘침 결함을 사전에 파악하여 문서에 기록하고, 사용자 최종 승인 대기 상태로 등록했다.
* **19:30 ~ 21:00 | Notion 허브 및 하위 기술 문서 로컬 작성**:
  * 대용량 문서 작성 시 AI 응답 중단 현상(Issue-02)을 방지하기 위해 섹션 단위 점진적 분할 작성 전략을 적용했다.
  * `docs/notion/hub.md` (20개 섹션 완성), `docs/notion/architecture.md` (아키텍처 및 DB 설계), `docs/notion/design.md` (디자인 및 레퍼런스), `docs/notion/implementation-log.md` (문제 해결 및 테스트 기록)를 로컬 마크다운 파일로 작성 완료했다.
  * P1 서브에이전트 조기 종료 문제(Issue-03)를 해결하기 위해 칸반 보드 트랙과 자소서 에디터 트랙으로 작업을 분할하고 재위임했다.
* **2026-11-11 | Notion 동기화**: Notion 허브 및 하위 문서 3종 동기화
* **2026-11-12 | 09:00 ~ 10:40 | 일정·할 일 자동 정리 및 백그라운드 AI 면접 질문 자동 생성**:
  * `src/services/automationService.js`를 구현해 공고 등록 시 `[회사명] 공고명 서류 마감` 일정(18:00)을 자동 생성하고, 지원 등록 시 마감 일정 연결(없으면 생성)과 `[회사명] 자기소개서 작성` 할 일을 자동 생성했다.
  * 지원 건이 1차/2차 면접 단계로 전환되면 `PUT`·`PATCH` API와 no-JS `POST`의 3개 경로 모두에서 면접 준비 할 일을 생성하고, 기존 AI 생성 질문이 3개 미만일 때 공유 속도 제한을 준수하며 중복 없이 백그라운드 AI 면접 질문을 자동 생성하도록 했다.
  * `test/automation.test.js` 6개 테스트를 통과했고 실호출 환경에서 AI 질문 7개가 자동 생성됨을 확인했다.
* **2026-11-12 | 10:40 ~ 11:50 | 자동 AI 피드백 옵션 (`users.auto_feedback`)**:
  * 설정 화면에 자동 AI 피드백 체크박스를 추가하고 `users.auto_feedback` 컬럼(기본 off)으로 저장했으며, 호출 비용 안내 문구를 함께 표시했다.
  * 옵션 활성화 시 자소서 버전 저장마다 답변이 입력된 문항별로 백그라운드 AI 피드백(`essay_feedback`)을 자동 생성·저장하고, 속도 제한에 도달하면 생성을 중단해 버전 저장 응답에는 영향을 주지 않도록 처리했다.
  * `test/auto-feedback.test.js` 6개 테스트를 통과했고 실호출로 3개 문항 약 29초 처리를 검증했다.
* **2026-11-12 | 11:50 ~ 13:20 | OpenAI `web_search` 기반 AI 공고 검색·추천**:
  * `GET /jobs/discover`와 `POST /api/jobs/search`에서 OpenAI Responses API 내장 `web_search` 도구(`tools: [{ type: "web_search" }]`, 한국 지역 힌트, `OPENAI_MODEL_SEARCH || 'gpt-6.1-terra'`)와 JSON 스키마 검증으로 최대 8건의 공고를 추천받도록 구현했다.
  * 유효한 `http`/`https` 출처 URL만 남기고 잘못된 마감일은 `null`로 처리했으며, 검색 결과를 DB에 자동 저장하지 않고 카드의 "공고 등록" 버튼(`POST /jobs`)으로만 반영되도록 면책 문구와 함께 구성했다.
  * `test/ai-search.test.js` 7개 테스트를 통과했고 실호출 11초 응답에서 원티드 링크 3건의 HTTP 200을 확인해 `docs/AI_WEB_SEARCH_VERIFICATION.md`에 검증 기록을 남겼다.
* **2026-11-12 | 13:20 ~ 14:40 | AI 주간 브리핑 및 일일 캐시**:
  * 대시보드 상단 카드와 `GET/POST /api/briefing`에서 본인 데이터(7일 내 마감·일정, 미완료 할 일, 단계별 진행 지원, 이번 달 목표)만 사용해 주간 브리핑을 생성하는 `src/services/aiBriefingService.js`를 구현했다(`OPENAI_MODEL_BRIEFING || 'gpt-6-luna'`).
  * `ai_briefings` 테이블(`UNIQUE(user_id, briefing_date)`)로 하루 1회 캐시하고 `force=1` 파라미터로 갱신하며, 본문 내부 링크는 allow-list로 허용 경로만 표시했다.
  * 동시 요청이 몰릴 때 진행 중인 브리핑 생성을 완료 대기 처리로 전환해 409 노출을 제거했다. `test/ai-briefing.test.js` 4개 테스트 통과 및 실호출 검증을 완료했다.
* **2026-11-12 | 14:40 ~ 15:50 | 파비콘·웹 앱 매니페스트 및 Render 무료 배포**:
  * `favicon.svg`/`.ico`, `apple-touch-icon`, `icon-192`/`512`, `site.webmanifest`를 적용해 브라우저 탭과 모바일 홈 화면 아이콘을 지원했다.
  * Render 무료 플랜으로 `https://readysetjob.onrender.com`을 배포하고 `AUTO_SEED=1`로 빈 DB에 데모 데이터를 자동 시드하도록 구성했다. 무료 플랜 재시작 시 데이터가 초기화되는 한계는 문서에 명시했다.
  * 이 단계에서 전체 18개 스위트 89개 테스트가 전원 통과했고 뷰 인라인 `style` 0건을 유지했다.
* **2026-11-12 | 15:50 ~ 16:40 | `--control-height` 토큰 기반 컨트롤 높이 통일**:
  * `--control-height`(38px), `-sm`(30px), `-lg`(44px) 토큰을 도입해 버튼·입력·선택 상자의 높이를 통일하고 자소서 상단바와 칸반 카드의 정렬 결함을 수정했다.
  * 27개 화면에 대해 데스크톱·모바일 자동 정렬 검사를 수행해 이상 0건을 확인했다.
* **2026-11-12 | 16:40 ~ 18:00 | AI 공고 찾기 목적 버튼·칩 방식 개편**:
  * 신입·경력·인턴·아르바이트·대학원 목적을 먼저 고르고 분야·지역·학위·근무 형태를 칩으로 선택하는 방식으로 `GET /jobs/discover` 화면을 전환했다.
  * 옵션은 서버 화이트리스트(`src/services/discoverOptions.js`)로 검증하고 목적별로 검색 출처를 지정했다. 실호출로 아르바이트 6건, 대학원 3건, 신입 2건 추천을 확인했다.
* **2026-11-12 | 18:00 ~ 19:40 | SSRF 방어 기업 로고 프록시 구현**:
  * `GET /logos/company`가 기업 홈페이지 도메인만 받아 구글·DuckDuckGo 파비콘 서비스에서만 로고를 조회하고 `company_logos` 테이블에 캐시(성공 30일, 없음 7일)하도록 구현했다.
  * 채용 사이트 도메인은 제외하고 이미지 시그니처를 검사했으며 사용자 소유권도 검증했다. 로고가 없으면 투명 이미지를 반환해 기존 이니셜 아바타를 그대로 유지했다.
  * `test/company-logos.test.js`를 통과했고 이 단계에서 전체 109개 테스트가 통과했다.
* **2026-11-13 | 09:00 ~ 10:30 | P2-SPEC 스펙 관리 스키마 및 듀얼 마이그레이션 구축**:
  * 자격증·부트캠프·공모전·대외활동·대학원 준비 이력을 관리하는 스펙 관리 모듈의 코어 스키마로 `spec_items`, `spec_watch`, `external_cache` 3개 테이블 DDL을 `src/db/schema.sql`에 추가해 도메인 테이블이 총 15개로 확장됐다.
  * `src/db/migrate.js`에 듀얼 마이그레이션을 구현했다. 신규 DB는 `events.spec_item_id`·`todos.spec_item_id` 외래 키(`ON DELETE CASCADE`)로, 기존 DB는 nullable 컬럼과 `(user_id, spec_item_id)` 인덱스 추가로 두 경로가 동일하게 동작한다.
  * 동일 원본의 중복 등록은 `(user_id, source, source_ref)` 원본 중복 키로 방지하고(NULL 원본 ID는 허용), 모든 조회·변경 쿼리에 `user_id` 조건을 적용해 소유하지 않은 항목은 404로 처리했다.
* **2026-11-13 | 10:30 ~ 11:50 | 스펙 5상태 칸반 보드·목록 뷰 구현**:
  * `/specs`에 5개 상태 컬럼 칸반 보드와 목록 표 뷰를 구현하고 종류·상태·검색어·기간 다중 조건 필터링과 상세 타임라인을 제공했다(`src/routes/specs.js`, `src/services/specsService.js`, `views/specs/*`).
  * 상태 변경은 POST 폼과 `PATCH` JSON API를 모두 지원하고 검증 실패 시 422로 폼을 다시 표시하며, 기존 CSRF 미들웨어와 인라인 스타일 없는 strict CSP를 그대로 유지했다.
* **2026-11-13 | 11:50 ~ 13:20 | `specAutomationService` 일정·할 일·자료함 멱등 자동화**:
  * 스펙 등록·수정·상태 변경 시 접수 시작(09:00)·접수 마감(18:00)·시험/시작(09:00)·결과 발표(09:00) 4개 일정 슬롯(`events`)과 원서 접수 할 일(`todos`)을 멱등하게 자동 연계하도록 `src/services/specAutomationService.js`를 구현했다.
  * 완료·합격 전이 시 연결된 자료가 없을 때만 경험 자료함(`materials`)에 STAR 초안을 자동 생성했다. 스펙 종류별로 자료 종류를 매핑하고 내용 첫 줄에 초안임을 명시해 STAR 보완을 안내했으며, 중단 시에는 오늘 포함 이후의 연결 일정과 미완료 할 일만 정리해 과거 이력은 보존했다.
  * 대시보드에 14일 이내 접수·시험 일정을 오름차순 최대 5개 표시하는 위젯(D-3 이하 긴급 배지)과 관심 자격증 구독(`spec_watch`) 기능을 추가했다.
* **2026-11-13 | 13:20 ~ 14:50 | `/specs/discover` 공공·검증 데이터 통합 탐색**:
  * Q-Net, DataQ, 잡알리오(ALIO), 고용24(Work24) 공공 소스와 AI 검증 소스 어댑터(`src/services/specSources/*`)를 구현하고 외부 조회에 대비한 자격증 카탈로그 폴백을 함께 제공했다.
  * 탐색 화면(`src/routes/specDiscover.js`, `views/specs/discover.ejs`)은 칩 필터로 조건을 좁히고, 검색 결과를 24자리 hex 세션 토큰으로 등록해야만 스펙에 반영되도록 세션을 격리했으며 잡알리오 결과는 공고로 분기했다.
* **2026-11-13 | 14:50 ~ 16:00 | 외부 통신 공통 가드 및 SSRF 방어 원문 검증기**:
  * `src/services/specSources/common.js`로 외부 API 통신에 8초 타임아웃과 응답 본문 1MiB 제한을 적용하고, 개인 데이터를 담지 않는 공유 캐시(`external_cache`)로 반복 조회를 절감했다.
  * `src/services/specSources/verifier.js`로 호스트 allow-list 확인, 사설 IP 차단, DNS 핀닝을 수행하고 응답 본문의 가시 텍스트에서 해당 데이터의 원문 증거를 교차 검증한다.
* **2026-11-13 | 16:00 ~ 17:30 | 스펙 테스트 63개 추가 및 전체 172개 테스트 검증**:
  * 스펙 관리 8개 테스트 스위트 63개 테스트(`test/specs*.test.js`, `test/spec-*.test.js`)를 작성해 전원 통과했고, 전체는 29개 스위트 172개 테스트로 `npm test` 100% 통과(pass 172, fail 0)를 달성했다.
  * Playwright 헤드리스로 1440·1280·768·390·375px 5개 해상도에서 스펙 6개 화면을 확인해 HTTP 200, 문서 가로 넘침 0건, 콘솔 오류 0건을 확보했고, CJK 검토에서 발견한 음절 분리와 날짜·요일 줄바꿈 결함을 수정한 뒤 재검토를 통과했다.
* **2026-11-13 | 17:30 ~ 19:00 | 계획서·최종 보고서 전면 동기화**:
  * 11-16 제출 예정인 `docs/PROJECT_PROPOSAL.md`의 구버전 Gemini 참조를 OpenAI Responses API(Structured Outputs: `gpt-6.1-terra` / `gpt-6-luna`) 기반 AI 4종 기능, AI 공고 탐색(`web_search`), 주간 브리핑, P2-SPEC 모듈 전체 명세로 전면 개정해 제출용 최종안을 완성했다.
  * `docs/FINAL_REPORT.md` 리빙 리포트에 최근 16개 커밋 이력, 15개 도메인 테이블 ERD 스키마, P2-SPEC 모듈, 실측 29개 스위트 172개 테스트 통과 수치를 동기화했다.
  * DSN-04/DSN-05 및 P0-03/04/08 항목 상태를 `검증 완료`로 맞춰 문서 간 정합성을 일치시켰다.

---

## 4. 향후 작업 마일스톤 및 실행 계획

> **2026-11-13 기준 진행 현황**: P0(기반 구축·인증·핵심 CRUD), P1(칸반·자소서 버전 관리), P2(대시보드·경험 자료함), P2-SPEC(스펙 관리·공공 데이터 연동), P3(디자인 시스템), P4(OpenAI AI 기능·자동화) 전 단계가 `검증 완료`에 도달했고 자동화 테스트는 29개 스위트 172개 테스트가 100% 통과(`npm test`)를 유지한다. 당초 2026-11-22(P1), 2026-11-30(P2), 2026-12-08(P3)로 계획했던 마일스톤은 모두 조기 완료되었고, 남은 실행 계획은 아래 두 가지뿐이다.

1. **프로젝트 계획서 제출 (2026-11-16 마감) | `구현 완료` (제출 대기)**:
   * `docs/PROJECT_PROPOSAL.md`를 OpenAI Responses API(Structured Outputs) 기반 AI 4종 기능, `web_search` 공고 탐색, 주간 브리핑, P2-SPEC 모듈 전체 명세로 전면 개정한 제출용 최종안을 2026-11-13에 완성했다(`검증 완료`).
   * 과목 평가 기준(기획 20%, 구현 50%, 보고서 20%, 창의성 5%, AI 활용 5%)에 부합하도록 최종 점검을 마쳤으며, 남은 작업은 마감일 제출 절차뿐이다.
2. **기말 최종 발표 및 최종 보고서 제출 (2026-12-16 마감) | `개발 중` (유일한 잔여 마일스톤)**:
   * `docs/FINAL_REPORT.md` 리빙 리포트를 최신 커밋 이력, 15개 도메인 테이블 ERD, 실측 테스트 수치(29개 스위트 172개 테스트)에 맞춰 지속 동기화한다.
   * 전체 172개 테스트 전원 통과 상태로 대기 중인 P2-SPEC 모듈의 기능 단위 커밋을 완료해 코드·테스트·문서의 정합성을 유지한다.
   * Render 배포 환경(`https://readysetjob.onrender.com`, `AUTO_SEED=1` 데모 데이터 자동 시드)을 활용한 발표 시연 시나리오를 준비하고, 발표 전 전체 회귀 테스트로 `검증 완료` 상태를 유지한다.
