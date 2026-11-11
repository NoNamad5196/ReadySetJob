# ReadySetJob 기능 및 비기능 요구사항 명세서 (SPEC)

본 문서는 취업·인턴 지원 현황 및 자기소개서 버전 관리 웹 애플리케이션 **ReadySetJob**의 기능 요구사항(Functional Requirements)과 비기능 요구사항(Non-Functional Requirements)을 정의한다. 모든 항목은 실제 코드베이스(`src/`, `test/`)와 단계별 개발 로드맵(P0~P4)을 기준으로 작성되었다.

## 1. 상태 및 우선순위 표기 기준

| 구분 | 값 | 의미 |
|---|---|---|
| 우선순위 | `P0` | 기반 구축, 데이터베이스 스키마, 인증/세션/CSRF, 핵심 CRUD (기업·공고·지원·일정) |
| 우선순위 | `P1` | 칸반 보드 드래그앤드롭 및 자기소개서 에디터·버전 스냅샷·Diff 비교·복원 |
| 우선순위 | `P2` | 대시보드 통계 차트(Chart.js), 경험 자료함(Materials) CRUD, 전체 필터·정렬 고도화 |
| 우선순위 | `P3` | 승인된 디자인 시스템 적용, 다크 모드 완성, 반응형·접근성·에러 UX 폴리싱 |
| 우선순위 | `P4` | OpenAI Responses API 기반 AI 4종 기능 (면접 질문·자소서 피드백·STAR 초안·채용공고 파싱, 키 미설정 시 안전 비활성화) |
| 상태 | `검증 완료` | 코드 구현이 완료되었으며 자동화 테스트(`node --test`)로 동작이 검증됨 |
| 상태 | `구현 완료` | 코드 또는 스키마가 구현되었으나 별도 통합 검증이 추가될 예정임 |
| 상태 | `개발 중` | 현재 P1 단계에서 병행 개발 중인 기능 (계획된 명세 기준) |
| 상태 | `계획` | 스키마는 준비되었으나 라우터·서비스·뷰는 P2 이후 구현 예정임 |

---

## 2. 모듈별 기능 요구사항 (Functional Requirements)

### 모듈 A. 사용자 인증 및 세션 관리 (AUTH)

| ID | 기능명 | 상세 요구사항 및 인수 조건 (Acceptance Criteria) | 우선순위 | 상태 |
|---|---|---|---|---|
| FR-AUTH-01 | 회원가입 | - `GET /signup`에서 회원가입 폼을 렌더링하고, 이미 로그인된 사용자는 `/dashboard`로 리다이렉트한다.<br>- `POST /signup`에서 `name`(필수, 공백 제거 후 비어 있지 않음), `email`(이메일 정규식 검증 및 소문자 정규화), `password`(최소 8자 이상)를 검증한다.<br>- 검증 실패 또는 이메일 중복 시 HTTP `422` 상태 코드와 함께 입력값(`email`, `name`)을 보존하여 폼을 재렌더링한다.<br>- 성공 시 `bcryptjs`(cost factor 10)로 비밀번호를 해싱해 `users` 테이블에 저장하고, `req.session.regenerate()`로 세션을 재발급한 뒤 `/dashboard`로 `302` 리다이렉트한다. | P0 | 검증 완료 (`test/auth-and-security.test.js`) |
| FR-AUTH-02 | 로그인 | - `GET /login`에서 로그인 폼을 렌더링하고, 로그인 상태면 `/dashboard`로 리다이렉트한다.<br>- `POST /login`에서 이메일 형식 오류 또는 비밀번호 미입력 시 HTTP `422`를 반환한다.<br>- 계정 미존재 또는 비밀번호 불일치 시 계정 존재 여부를 노출하지 않는 동일 메시지(`이메일 또는 비밀번호가 올바르지 않습니다.`)와 함께 HTTP `401`로 폼을 재렌더링한다.<br>- 인증 성공 시 세션 고정(Session Fixation) 방지를 위해 `req.session.regenerate()` 호출 후 `req.session.user = { id, email, name }`을 저장하고 `/dashboard`로 리다이렉트한다. | P0 | 검증 완료 (`test/auth-and-security.test.js`) |
| FR-AUTH-03 | 로그아웃 | - `POST /logout` 요청 시 CSRF 토큰을 검증한 후 `req.session.destroy()`로 서버 세션을 파기한다.<br>- `readysetjob.sid` 세션 쿠키를 `res.clearCookie('readysetjob.sid')`로 제거하고 `/login`으로 `302` 리다이렉트한다. | P0 | 검증 완료 (`test/auth-and-security.test.js`) |
| FR-AUTH-04 | 인증 보호 미들웨어 (`requireAuth`) | - 비로그인 상태에서 보호된 HTML 페이지 접근 시 `/login`으로 `302` 리다이렉트한다.<br>- 비로그인 상태에서 `/api/*` 경로 요청 시 HTTP `401`과 JSON `{ error: '로그인이 필요합니다.' }`를 반환한다.<br>- 루트(`GET /`) 접근 시 로그인 여부에 따라 `/dashboard` 또는 `/login`으로 분기한다. | P0 | 검증 완료 (`test/auth-and-security.test.js`) |
| FR-AUTH-05 | CSRF 토큰 발급 및 검증 | - 세션당 32바이트 난수 hex 문자열(`req.session.csrfToken`)을 생성하고 `res.locals.csrfToken` 및 `<meta name="csrf-token">`으로 노출한다.<br>- `GET`, `HEAD`, `OPTIONS` 외의 모든 상태 변경 요청에서 `req.body._csrf` 또는 `X-CSRF-Token` 헤더를 `crypto.timingSafeEqual`로 비교한다.<br>- 토큰 누락·불일치 시 `/api/*`는 HTTP `403` JSON, 일반 페이지는 HTTP `403` 에러 페이지(`views/error.ejs`)를 반환한다. | P0 | 검증 완료 (`test/auth-and-security.test.js`) |

---

### 모듈 B. 기업·채용 공고·지원 현황·일정·칸반 보드 (APP)

| ID | 기능명 | 상세 요구사항 및 인수 조건 (Acceptance Criteria) | 우선순위 | 상태 |
|---|---|---|---|---|
| FR-APP-01 | 기업(Companies) CRUD 및 검색 | - `GET /companies`에서 현재 사용자(`user_id`)의 기업 목록을 공고 수(`job_count`), 지원 수(`application_count`)와 함께 조회하며, 키워드(`?q=`)로 기업명·산업군·메모를 부분 일치 검색한다.<br>- `POST /companies` 및 `PUT /companies/:id`에서 `name` 필수 여부, `website` URL 프로토콜(`http:` 또는 `https:`), 사용자별 기업명 중복(`UNIQUE(user_id, name)`)을 검증하고 실패 시 `422`를 반환한다.<br>- `GET /companies/:id`에서 기업 상세 정보와 연결된 채용 공고 목록을 함께 표시한다.<br>- `DELETE /companies/:id`로 기업 삭제 시 하위 공고·지원 내역이 `ON DELETE CASCADE`로 연쇄 삭제된다. | P0 | 검증 완료 (`test/crud-and-ownership.test.js`, `test/ownership-and-seed.test.js`) |
| FR-APP-02 | 채용 공고(Job Posts) CRUD 및 인라인 기업 생성 | - `GET /jobs`에서 검색어(`q`), 채용 형태(`employment_type`: `intern`, `new_grad`, `experienced`, `other`), 북마크 여부(`bookmarked=1`), 정렬(`deadline` 마감 임박순 기본, `recent` 최신 등록순)을 지원한다.<br>- `POST /jobs` 등록 시 기존 `company_id` 선택뿐 아니라 `new_company_name` 입력을 통한 신규 기업 동시 생성(`db.transaction`)을 지원한다. 이미 동일 이름의 기업이 있으면 해당 기업을 재사용한다.<br>- 마감일(`deadline`, `YYYY-MM-DD`) 기반으로 `calculateDday()` 헬퍼가 `D-Day`, `D-N`(`urgent` ≤3일, `soon` ≤7일, `upcoming` >7일), `마감 (D+N)`(`expired`), `상시/미정`(`none`) 배지를 계산한다. | P0 | 검증 완료 (`test/crud-and-ownership.test.js`) |
| FR-APP-03 | 지원 내역(Applications) CRUD 및 전형 단계·결과 분리 | - `applications` 테이블은 채용 공고당 1건(`job_post_id UNIQUE`)만 생성 가능하며, 중복 지원 시 `DUPLICATE_APPLICATION`을 잡아 `422`로 폼에 오류를 표시한다.<br>- 전형 단계(`stage`: `document`, `coding_test`, `assignment`, `interview1`, `interview2`, `final`)와 전형 결과(`result`: `in_progress`, `passed`, `failed`, `withdrawn`)를 별도 컬럼으로 관리한다.<br>- `GET /applications`에서 `stage`, `result`, `q`(기업명·공고명·직무·메모) 필터링을 제공한다.<br>- `GET /applications/:id` 상세 화면에서 전형 변경 이력(`stageLogs`)과 연결된 일정(`events`)을 함께 조회한다. | P0 | 검증 완료 (`test/crud-and-ownership.test.js`) |
| FR-APP-04 | 전형 단계 변경 API 및 이력(`stage_logs`) 자동 기록 | - 지원 생성 시 초기 상태(`from_stage: null -> to_stage`, `from_result: null -> to_result`)를 `stage_logs`에 트랜잭션으로 기록한다.<br>- `PUT /applications/:id` 수정 시 이전 단계/결과와 달라진 경우에만 `stage_logs`에 이력을 추가한다.<br>- `PATCH /api/applications/:id/stage` 호출 시 `stage`(필수)와 선택적 `result`, `board_order`를 검증(실패 시 `422` JSON)하고, 트랜잭션 내에서 `applications` 갱신 및 `stage_logs` 기록 후 갱신된 객체와 이력을 JSON으로 반환한다. | P0 | 검증 완료 (`test/crud-and-ownership.test.js`) |
| FR-APP-05 | 전형 일정(Events) 등록·조회·삭제 | - `GET /events`에서 사용자의 전체 일정을 시작 일시(`starts_at ASC`) 순으로 조회하고, 연결된 지원 내역·공고·기업 정보를 함께 표시한다.<br>- `POST /events`에서 `title`(필수), `type`(`deadline`, `test`, `interview`, `announcement`, `other`), `starts_at`(유효한 일시 문자열), 선택적 `application_id`(본인 소유 지원 건인지 검증, 타인/미존재 시 `404`)를 검증 후 저장한다.<br>- `DELETE /events/:id`로 일정을 삭제하고 `redirect_to` 또는 `/events`로 이동한다. | P0 | 검증 완료 (`test/crud-and-ownership.test.js`) |
| FR-APP-06 | 칸반 보드 뷰 (`GET /applications/board`) | - P1 계획된 명세: 6개 전형 단계(`document` ~ `final`)를 컬럼으로 구성한 칸반 보드 화면을 렌더링한다.<br>- 각 컬럼 내부 카드는 `board_order ASC, updated_at DESC` 순으로 정렬되며 기업명, 공고 제목, 직무, 전형 결과 배지, 마감일 D-Day를 표시한다.<br>- 드래그앤드롭이 불가능한 환경 및 키보드 사용자를 위해 카드 내 단계 이동 컨트롤을 함께 제공한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |
| FR-APP-07 | 칸반 카드 드래그앤드롭 및 순서(`index`) 재정렬 | - P1 계획된 명세: `PATCH /api/applications/:id/stage`가 `{ stage, result?, index? }` (또는 `board_order`) 페이로드를 받아 컬럼 간 이동 및 동일 컬럼 내 카드 순서 재정렬을 단일 트랜잭션으로 처리한다.<br>- 단계(`stage`) 또는 결과(`result`)가 실제로 변경된 경우 `stage_logs`를 기록하고, 순서만 변경된 경우 `board_order`만 재계산한다.<br>- 요청 시 `X-CSRF-Token` 헤더가 필수이며, 타 사용자 카드 조작 시 `404` JSON을 반환한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |

---

### 모듈 C. 자기소개서 작성 및 버전 관리 (ESSAY)

> 모듈 C는 DB 스키마(`essays`, `essay_questions`, `essay_versions`, `essay_materials`)가 P0에서 구축 완료되었으며, 라우터·서비스·뷰는 **P1 (개발 중, 계획된 명세)** 단계에서 구현 중이다.

| ID | 기능명 | 상세 요구사항 및 인수 조건 (Acceptance Criteria) | 우선순위 | 상태 |
|---|---|---|---|---|
| FR-ESSAY-01 | 자기소개서 목록·생성·편집기 화면 | - `GET /essays`: 사용자의 자기소개서 목록(연결된 지원 기업/공고, 문항 수, 최신 버전 번호, 최종 수정일)을 조회한다.<br>- `GET /essays/new`, `POST /essays`: 제목(`title`), 선택적 지원 내역(`application_id`), 초기 문항 배열(`question`, `char_limit`)을 입력받아 자기소개서와 문항(`essay_questions`)을 생성한다.<br>- `GET /essays/:id`: 멀티 문항 편집기, 실시간 글자수/글자수 제한(`char_limit`) 표시기, 저장된 버전 히스토리 사이드바, 연결된 경험 자료(`materials`) 패널을 렌더링한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |
| FR-ESSAY-02 | 작업 초안(Draft) 저장 (버전 미생성) | - `PUT /api/essays/:id/draft`: 현재 편집 중인 자기소개서 제목 및 문항별 내용(`question`, `answer`, `char_limit`, `sort_order`)을 `essays` 및 `essay_questions` 테이블에 저장한다.<br>- 초안 저장은 `essay_versions` 테이블에 새 행을 추가하지 않으며, 작성 중인 작업 상태만 갱신한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |
| FR-ESSAY-03 | 불변(Immutable) 버전 스냅샷 생성 | - `POST /essays/:id/versions`: 현재 문항 전체(`essay_questions`)를 직렬화한 `snapshot_json`과 사용자 지정 라벨(`label`, 예: `1차 제출본`)을 묶어 `essay_versions`에 불변 레코드로 삽입한다.<br>- 버전 번호(`version_no`)는 해당 `essay_id`의 `COALESCE(MAX(version_no), 0) + 1`로 트랜잭션 내에서 부여하며 `UNIQUE(essay_id, version_no)` 제약을 준수한다.<br>- 한 번 생성된 `essay_versions` 행은 수정(`UPDATE`)하지 않는다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |
| FR-ESSAY-04 | 버전 목록 및 특정 버전 스냅샷 조회 | - `GET /essays/:id/versions`: 해당 자기소개서의 전체 버전 메타데이터(`version_no`, `label`, `restored_from_version_id`, `created_at`) 목록을 조회한다.<br>- `GET /essays/:id/versions/:no`: 특정 버전 번호(`:no`)의 `snapshot_json`을 파싱하여 문항별 질문·답변·글자수를 읽기 전용으로 표시한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |
| FR-ESSAY-05 | 버전 간 서버 사이드 단어 단위 Diff 비교 | - `GET /essays/:id/compare?from=:v1&to=:v2`: 두 버전(`from`, `to`)의 스냅샷을 로드하여 문항별로 서버 사이드 `jsdiff`(`diffWords`) 비교를 수행한다.<br>- XSS 방지를 위해 원본 텍스트를 먼저 HTML 이스케이프한 뒤 추가(`<ins>`)·삭제(`<del>`) 마크업을 생성하여 렌더링한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |
| FR-ESSAY-06 | 이전 버전 복원 (이력 보존형) | - `POST /essays/:id/versions/:no/restore`: 단일 트랜잭션 내에서 (1) 현재 작업 초안(`essay_questions`)이 직전 최신 버전 스냅샷과 다를 경우 자동 백업 버전을 먼저 생성하고, (2) 대상 버전(`:no`)의 스냅샷 내용으로 `essay_questions` 초안을 덮어쓰며, (3) `restored_from_version_id`에 대상 버전 ID를 기록한 새 버전(`max + 1`)을 생성한다.<br>- 이를 통해 복원 시에도 기존 작성 내용과 버전 히스토리가 유실되지 않는다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |
| FR-ESSAY-07 | 과거 자기소개서 문항·답변 키워드 검색 | - `GET /api/essays/search?q=`: 사용자의 모든 자기소개서 제목, 문항 질문(`essay_questions.question`), 답변(`essay_questions.answer`)에서 키워드를 검색하여 편집기 참고 패널 등에서 즉시 인용할 수 있도록 JSON 결과를 반환한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |

---

### 모듈 D. 대시보드 및 통계 (DASH)

| ID | 기능명 | 상세 요구사항 및 인수 조건 (Acceptance Criteria) | 우선순위 | 상태 |
|---|---|---|---|---|
| FR-DASH-01 | 핵심 지표 요약 카드 조회 | - `GET /dashboard`에서 `getDashboardCounts(db, userId)`를 호출하여 등록 기업 수(`companiesCount`), 전체 공고 수(`jobsCount`), 관심 공고 수(`bookmarkedJobsCount`), 총 지원 수(`applicationsCount`), 진행 중(`inProgressCount`), 합격(`passedCount`), 등록 일정 수(`upcomingEventsCount`) 7개 지표를 표시한다. | P0 | 검증 완료 (`test/auth-and-security.test.js`) |
| FR-DASH-02 | 전형 단계별·결과별 분포 차트 | - `chart.js`를 npm 패키지로 설치 후 `/vendor` 정적 경로로 서빙하여(외부 CDN 금지) 전형 단계별 지원 건수 막대 차트 및 합격/불합격/진행중 비율 도넛 차트를 렌더링한다. | P2 | 계획 |
| FR-DASH-03 | 마감 임박 공고(D-7 이내) 위젯 | - 대시보드 하단에 마감일이 오늘 이후 7일 이내(`D-Day` ~ `D-7`)인 미지원/진행중 공고 목록을 우선 노출한다. | P2 | 계획 |
| FR-DASH-04 | 다가오는 전형 일정 타임라인 위젯 | - 대시보드에서 향후 예정된 면접·코딩테스트·서류 마감 일정을 시간순으로 요약 표시한다. | P2 | 계획 |

---

### 모듈 E. 관심 공고 북마크 및 경험 자료함 (MAT)

| ID | 기능명 | 상세 요구사항 및 인수 조건 (Acceptance Criteria) | 우선순위 | 상태 |
|---|---|---|---|---|
| FR-MAT-01 | 채용 공고 북마크 토글 및 필터 | - `POST /jobs/:id/bookmark` 호출 시 해당 공고의 `is_bookmarked` 값을 `0 <-> 1`로 토글한다.<br>- `Accept: application/json` 헤더가 있으면 `{ id, is_bookmarked }` JSON(`200`)을 반환하고, 폼 제출이면 플래시 메시지와 함께 `redirect_to` 또는 `/jobs/:id`로 리다이렉트한다.<br>- `GET /jobs?bookmarked=1`로 관심 공고만 필터링할 수 있다. | P0 | 검증 완료 (`test/crud-and-ownership.test.js`) |
| FR-MAT-02 | 경험 자료함(Materials) CRUD | - `materials` 테이블(`kind`: `experience`, `project`, `award`, `activity`, `other`, `title`, `period`, `content`, `tags`)에 대한 목록·생성·수정·삭제 라우터(`/materials`)를 제공한다. | P2 | 계획 |
| FR-MAT-03 | 자료함 분류(`kind`) 및 태그(`tags`) 필터 | - 경험 자료 목록에서 분류별 필터와 키워드/태그 검색을 제공한다. | P2 | 계획 |
| FR-MAT-04 | 자기소개서-경험 자료 N:M 연결 및 해제 | - P1 계획된 명세: `essay_materials`(`essay_id`, `material_id` 복합 PK)를 통해 특정 자기소개서에 활용된 경험 소재를 연결(link)하거나 연결 해제(unlink)하고 편집기 화면 우측에서 참조한다. | P1 | 구현 완료 (2026-11-10 자동 테스트·브라우저 확인) |

---

### 모듈 F. OpenAI Responses API 연동 AI 4종 기능 (AI)

| ID | 기능명 | 상세 요구사항 및 인수 조건 (Acceptance Criteria) | 우선순위 | 상태 |
|---|---|---|---|---|
| FR-AI-01 | OpenAI 기반 면접 질문 서버 사이드 생성 | - `POST /applications/:id/interview-questions/generate`: 해당 지원 건의 기업·공고·직무 정보와 연결된 자기소개서 문항/답변을 조합하여 서버 사이드에서 OpenAI Responses API(Structured Outputs, `OPENAI_MODEL_INTERVIEW || 'gpt-6.1-terra'`, effort `low`)를 호출하고 질문을 `interview_questions`(`source = 'ai'`)에 저장한다.<br>- 클라이언트에 API 키를 절대 노출하지 않는다. | P4 | 검증 완료 (`test/interview-questions.test.js`) |
| FR-AI-02 | 수동 면접 질문 관리 | - 사용자가 직접 면접 질문(`source = 'manual'`)을 추가·삭제하며 AI 생성 질문과 함께 지원 상세 및 면접 준비 화면에서 복기·준비할 수 있다. | P4 | 검증 완료 (`test/interview-questions.test.js`) |
| FR-AI-03 | `OPENAI_API_KEY` 미설정 시 우아한 비활성화 | - 환경 변수 `OPENAI_API_KEY`가 비어 있거나 설정되지 않은 경우 AI 기능 버튼을 비활성화하고 정직한 안내(`AI 기능이 비활성화되어 있습니다 (OPENAI_API_KEY 미설정)`)를 표시하며, API 요청 시 HTTP `503`을 반환한다. 가짜(mock) 응답을 절대 반환하지 않는다. | P4 | 검증 완료 (`test/ai-features.test.js`, `test/ai-errors-and-limits.test.js`) |
| FR-AI-04 | 자기소개서 문항별 AI 피드백 생성 및 조회 | - `POST /api/essays/:id/questions/:qid/feedback`: 질문, 답변, 글자수, 공고 직무 맥락을 바탕으로 구조화된 첨삭 피드백(총평, 강점, 개선점, 구체적 수정 제안, 예시 문장)을 생성하고 `essay_feedback` 테이블에 저장한다.<br>- `GET /api/essays/:id/questions/:qid/feedback`으로 최신 피드백을 조회한다. (`OPENAI_MODEL_FEEDBACK || 'gpt-6.1-terra'`, effort `medium`) | P4 | 검증 완료 (`test/ai-features.test.js`, `test/ai-errors-and-limits.test.js`) |
| FR-AI-05 | 경험 소재 기반 STAR 구조화 초안 생성 및 반영 | - `POST /api/materials/:id/star-draft`: 경험 자료(제목, 분류, 기간, 본문, 태그)를 Situation, Task, Action, Result 및 한 줄 요약, 보완 필요 정보로 구조화하고 `material_star_drafts`에 저장한다. (`OPENAI_MODEL_DRAFT || 'gpt-6.1-terra'`, effort `low`)<br>- `POST /materials/:id/star-draft/:draftId/apply`: 생성된 초안 블록을 기존 자료 본문 하단에 포맷팅하여 추가한다. | P4 | 검증 완료 (`test/ai-features.test.js`, `test/ai-errors-and-limits.test.js`) |
| FR-AI-06 | 채용 공고 텍스트 자동 파싱 및 폼 채우기 | - `POST /api/jobs/parse`: 복사한 채용 공고 원문 텍스트에서 기업명, 공고 제목, 직무, 고용 형태, 마감일, URL, 요약 메모, 자기소개서 문항 목록을 JSON Schema로 추출하여 반환한다. (`OPENAI_MODEL_EXTRACT || 'gpt-6-luna'`, effort `none`)<br>- DB에 자동 저장하지 않고 브라우저 폼 입력 필드를 자동으로 채워 오입력을 방지한다. | P4 | 검증 완료 (`test/ai-features.test.js`, `test/ai-errors-and-limits.test.js`) |
| FR-AI-07 | 공통 모델 오버라이드 및 통합 속도 제한 | - 전역 `OPENAI_MODEL` 또는 기능별 `OPENAI_MODEL_*` 환경 변수를 지원하며, API 키 원문은 설정 화면(`GET /settings/ai`)과 로그에 절대 노출하지 않는다.<br>- 4가지 AI 기능을 통틀어 사용자당 10분 내 최대 20회의 통합 슬라이딩 윈도우 속도 제한(429)을 적용한다. | P4 | 검증 완료 (`test/ai-errors-and-limits.test.js`) |

---

## 3. 비기능 요구사항 (Non-Functional Requirements)

| ID | 구분 | 요구사항 명세 | 구현 및 검증 상태 |
|---|---|---|---|
| NFR-SEC-01 | 데이터 소유권 격리 | 모든 사용자 데이터 조회·수정·삭제 SQL은 `WHERE ... user_id = ?` 조건을 포함해야 한다. 타 사용자의 리소스 ID에 접근할 경우 존재 여부를 노출하지 않도록 `403`이 아닌 `404`를 반환한다. | 검증 완료 (`test/ownership-and-seed.test.js`) |
| NFR-SEC-02 | SQL 인젝션 방지 | 모든 DB 쿼리는 `better-sqlite3`의 `db.prepare(...).get/all/run(...)` 바인딩 파라미터만 사용하며, 사용자 입력값을 문자열 결합으로 SQL에 삽입하지 않는다. | 구현 완료 (`src/services/*.js`) |
| NFR-SEC-03 | 세션 및 쿠키 보안 | `express-session` 쿠키(`readysetjob.sid`)는 `httpOnly: true`, `sameSite: 'lax'`, 유효기간 7일(`604800000ms`)로 설정하고 SQLite 세션 스토어에 영속화한다. 로그인/회원가입 직후 `req.session.regenerate()`를 수행한다. | 검증 완료 (`test/auth-and-security.test.js`) |
| NFR-SEC-04 | 보안 헤더 및 CSP | `helmet`을 통해 `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:`, `frame-ancestors 'none'`, `object-src 'none'` CSP 정책을 강제하여 외부 스크립트 주입 및 클릭재킹을 차단한다. | 구현 완료 (`src/app.js`) |
| NFR-SEC-05 | 비밀값 관리 | `SESSION_SECRET`, `OPENAI_API_KEY` 등 민감 정보는 `.env`를 통해 주입하며 저장소에는 `.env.example`만 커밋한다. | 구현 완료 (`.gitignore`, `.env.example`) |
| NFR-PERF-01 | 경량 실행 및 트랜잭션 | 헤드리스 리눅스 컨테이너 환경을 고려해 무거운 프론트엔드 번들러나 상주 워커 프로세스를 두지 않고, `better-sqlite3` WAL 모드(`PRAGMA journal_mode = WAL`)와 동기 트랜잭션(`db.transaction`)으로 데이터 정합성과 응답 속도를 확보한다. | 구현 완료 (`src/db/connection.js`) |
| NFR-PERF-02 | 세션 만료 타이머 정리 | `SqliteSessionStore`의 만료 세션 정리 `setInterval` 타이머에 `timer.unref()`를 호출하여 테스트 종료 시 이벤트 루프가 블로킹되지 않도록 한다. | 구현 완료 (`src/app.js`) |
| NFR-A11Y-01 | 시맨틱 마크업 및 접근성 | 모든 폼 입력 필드에 `<label for="...">`를 연결하고, 내비게이션에 `aria-label="주 메뉴"`, 비활성 메뉴에 `aria-disabled="true"`, 플래시 알림에 `role="status"`를 부여한다. | 구현 완료 (`views/layouts/main.ejs`, `views/**/*.ejs`) |
| NFR-UI-01 | 디자인 토큰 및 다크 모드 | 모든 색상은 하드코딩하지 않고 `public/css/tokens.css`의 CSS 변수(`--color-*`, `--space-*`, `--radius-*`)를 사용한다. `<html data-theme="light|dark">`와 `localStorage('rsj_theme')`를 통해 테마 전환을 지원한다. | 구현 완료 (`public/css/tokens.css`, `public/js/app.js`) |
| NFR-COMPAT-01 | 브라우저 및 외부 의존성 | 최신 데스크톱·모바일 브라우저(Chrome, Edge, Safari, Firefox)에서 동작하며, 외부 CDN 없이 로컬 정적 자산(`/css`, `/js`, `/vendor`)만으로 오프라인/폐쇄망에서도 동일하게 렌더링된다. | 구현 완료 (`src/app.js`) |
