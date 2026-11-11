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

---

## 4. 향후 작업 마일스톤 및 실행 계획

1. **프로젝트 계획서 제출 (2026-11-16 마감)**:
   * `docs/PROJECT_PROPOSAL.md` 초안을 최종 점검하고 과목 평가 기준(기획 20%, 구현 50%, 보고서 20%, 창의성 5%, AI 활용 5%)에 부합하도록 완성한다.
2. **P1 칸반 및 자기소개서 버전 관리 완성 (2026-11-22 목표)**:
   * 칸반 보드 화면 렌더링 및 드래그앤드롭 카드 이동, 컬럼 내 순서(`board_order`) 재정렬 API 연동.
   * 자기소개서 멀티 문항 에디터, 실시간 글자수/바이트 카운터, 초안 저장, 불변 버전 스냅샷 생성, 서버 사이드 `jsdiff` 단어 단위 Diff 비교 화면 구현.
   * 이력 보존형 버전 복원 트랜잭션(`restoreEssayVersion`) 및 통합 테스트 작성.
3. **P2 대시보드 통계 및 경험 자료함 (2026-11-30 목표)**:
   * Chart.js 로컬 서빙 기반 단계별 전환율 막대 차트 및 합불 도넛 차트 구현.
   * 경험 자료함(`/materials`) CRUD 및 자기소개서 N:M 매핑(`essay_materials`) 연동.
4. **P3 디자인 시스템 적용 및 폴리싱 (2026-12-08 목표)**:
   * 사용자 승인된 디자인 시안을 바탕으로 `docs/DESIGN_SYSTEM.md` 확정 및 전체 EJS 뷰에 CSS 토큰 반영.
   * 다크 모드, 반응형 레이아웃, 키보드 접근성 검수.
5. **P4 AI 면접 질문 생성 및 최종 보고서 제출 (2026-12-16 마감)**:
   * Gemini API 기반 서버 사이드 면접 질문 생성(키 미설정 시 우아한 비활성화) 구현.
   * 기말 최종 보고서(`docs/FINAL_REPORT.md`) 작성 및 시연 준비.
