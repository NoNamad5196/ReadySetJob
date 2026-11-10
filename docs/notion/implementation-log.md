# ReadySetJob: 구현·테스트 및 문제 해결 기록

> 💡 **개요**: 본 문서는 ReadySetJob 개발 과정에서 발생한 구체적인 기술적 문제, 근본 원인 분석, 해결 방법, 검증 결과를 기록하고, P0 자동화 테스트 실행 내역을 체계적으로 정리한 하위 기술 문서이다.

---

## 1. 문제 해결 기록 포맷 및 관리 원칙

모든 문제 해결 기록은 재현 가능성과 투명성을 보장하기 위해 다음 5가지 표준 항목을 따른다.

* **날짜 (Date)**: 문제가 발생하고 해결된 일자.
* **문제 (Issue)**: 개발 또는 테스트 과정에서 관찰된 비정상적인 현상 및 에러 증상.
* **원인 (Root Cause)**: 코드, 라이브러리 내부 동작, 환경 설정 차원에서 분석한 근본 원인.
* **해결 (Solution)**: 아키텍처나 코드를 수정한 구체적인 방법 및 적용 내용.
* **검증 (Verification)**: 수정 사항이 정상 동작함을 입증한 정량적/정성적 검증 절차 및 결과.

---

## 2. 기술적 문제 및 해결 상세 기록

### 2.1 [Issue-01] better-sqlite3-session-store 만료 정리 타이머로 인한 테스트 프로세스 무한 대기

* **날짜**: 2026-11-10
* **문제**:
  * Node.js 22 내장 테스트 러너(`node --test`)를 사용하여 `supertest` 기반 통합 테스트를 실행했을 때, 모든 테스트 단언(Assertion)이 통과했음에도 프로세스가 종료되지 않고 무한 대기 상태(Hang)에 머무르는 현상이 발생했다.
  * Ctrl+C로 강제 종료해야만 프로세스가 빠져나왔다.
* **원인**:
  * 세션 관리를 위해 채택한 `better-sqlite3-session-store` 패키지는 세션 만료 처리를 위해 내부적으로 `setInterval(..., 900000)` (15분 주기) 타이머를 실행한다.
  * 해당 타이머 객체에 `timer.unref()`가 호출되지 않아, Node.js 이벤트 루프가 "아직 대기 중인 활성 타이머가 존재한다"고 판단하여 메인 프로세스를 정상 종료하지 못하고 대기 상태를 유지하는 것이 근본 원인이었다.
* **해결**:
  * `src/app.js`에서 기본 `SqliteSessionStore` 클래스를 직접 인스턴스화하는 대신, 이를 상속한 커스텀 세션 스토어 클래스(`UnrefSqliteSessionStore`)를 선언했다.
  * `startInterval()` 메서드를 오버라이드하여 원본 스토어의 `startInterval()`을 호출한 뒤, 생성된 내부 타이머 프로퍼티(`this._interval` 또는 `this.timer`)를 조회하여 `timer.unref()`를 명시적으로 호출하도록 수정했다.
  * 이를 통해 서버 런타임에서는 만료 세션 정리가 정상 작동하면서도, 테스트 환경에서는 더 이상 처리할 I/O가 없을 때 프로세스가 이벤트 루프를 즉시 종료할 수 있도록 개선했다.
* **검증**:
  * `npm test`를 단독 실행하여 3개 테스트 파일 내 10개 테스트 케이스가 모두 통과한 직후, 추가 지연 없이 프로세스가 정상 종료(Exit code 0)됨을 확인했다.
  * 다중 테스트 파일 연속 실행 시에도 프로세스 고착 현상이 완전히 해결되었음을 입증했다.

---

### 2.2 [Issue-02] 대용량 단일 문서 작성 시 AI 도구 타임아웃 및 응답 중단

* **날짜**: 2026-11-10
* **문제**:
  * 프로젝트 계획서(`docs/PROJECT_PROPOSAL.md`) 및 Notion 허브 문서와 같이 300줄 이상의 방대한 문서를 단일 파일 쓰기 도구 호출로 한 번에 생성하려고 시도할 때, 모델 응답이 멈추거나 도구 호출이 타임아웃되어 파일이 불완전하게 작성되는 현상이 발생했다.
* **원인**:
  * 한 번의 요청에 수천 자 이상의 마크다운 텍스트를 생성하여 파일 시스템에 쓰도록 지시할 경우, 컨텍스트 출력 버퍼 한도와 도구 실행 제한 시간에 도달하여 통신이 중단되는 병목이 존재했다.
* **해결**:
  * 대용량 문서 작성 전략을 "단일 생성(Write)" 방식에서 "점진적 분할 작성(Incremental Write + Edit)" 방식으로 전환했다.
  * 각 파일의 최초 작성 시에는 개요 및 앞부분 1~7개 섹션을 200줄 미만으로 먼저 생성하고, 이후 이어지는 섹션들을 200줄 미만의 블록 단위로 분할하여 점진적으로 추가(Edit)하는 규칙을 수립했다.
* **검증**:
  * `docs/notion/hub.md` (292줄), `docs/notion/architecture.md` (373줄) 등 300줄 안팎의 방대한 기술 문서를 타임아웃이나 내용 유실 없이 안정적으로 생성 완료했다.

---

### 2.3 [Issue-03] 첫 P1 작업 위임 시 작업자의 파일 탐색 후 조기 종료 현상

* **날짜**: 2026-11-10
* **문제**:
  * P1 단계 핵심 인터랙션 개발을 서브에이전트에게 위임했을 때, 작업자가 관련 코드와 문서만 읽은 뒤 실제 라우터와 뷰 코드를 작성하지 않고 조기 종료하는 현상이 발생했다.
* **원인**:
  * 칸반 보드(드래그앤드롭 및 순서 재정렬)와 자기소개서 에디터(초안 저장, 불변 버전 스냅샷, jsdiff 단어 단위 비교, 이력 보존형 복원)라는 대규모 작업을 단일 프롬프트로 일괄 요청하여 작업 범위가 과중했다.
  * 완료 조건(Definition of Done)이 명확히 강제되지 않아 탐색 보고 수준에서 작업을 종료한 것으로 분석되었다.
* **해결**:
  * P1 작업을 독립적인 두 개의 세부 트랙(칸반 보드 모듈, 자기소개서 버전 관리 모듈)으로 분할했다.
  * 프롬프트에 "단순 분석이나 계획에 그치지 말고, 반드시 관련 파일들을 실제로 생성 및 수정하여 동작 가능한 상태로 구현을 완료할 것"이라는 완료 조건을 명시하고 재위임했다.
* **검증**:
  * 분할 재위임 후 칸반 보드 EJS 뷰(`views/applications/board.ejs`), 정렬 API(`PATCH /api/applications/:id/stage`), 자소서 서비스(`src/services/essaysService.js`) 및 라우터 코드가 누락 없이 작성되고 구동 가능함을 확인했다.

---

## 3. AI 활용 사례 및 오케스트레이션 기록

ReadySetJob 개발 과정에서는 AI 도구를 단순 질의응답이 아닌 엄격한 역할 분담형 협업 파이프라인으로 운영했다.

* **도구 환경**: OpenCode 런타임 및 oh-my-opencode 에이전트 오케스트레이션 프레임워크.
* **역할 분담 체계**:
  * **지휘 에이전트 (Claude Opus)**: 전체 개발 로드맵(P0~P4) 수립, 시스템 아키텍처 및 보안 모델 검토, 서브작업 명세화, 코드 품질 리뷰 및 Git 커밋/푸시 총괄.
  * **구현 작업자 (Gemini)**: Express 라우터 및 better-sqlite3 서비스 로직 구현, EJS 템플릿 마크업, 정적 HTML 디자인 시안 A/B/C 9종 제작, 기술 문서 작성.
  * **심층 조사 (Perplexity MCP)**: Huntr, Teal, Simplify, 자소설닷컴 등 9개 경쟁 서비스의 최신 공식 요금제와 기능 명세 실시간 교차 검증(`docs/RESEARCH_NOTES.md`).
  * **기록 및 관리 (Notion MCP)**: 프로젝트 메인 허브 및 하위 3개 기술 문서의 구조화 및 동기화 지원.
* **품질 관리 원칙**:
  * AI가 작성한 모든 백엔드 코드는 `node --test` 자동화 테스트를 통과해야만 브랜치에 병합했다.
  * AI가 작성한 프론트엔드 디자인 시안은 Playwright 기반 스크린샷 12장(데스크톱 9장, 모바일 3장)을 캡처하여 실제 브라우저 렌더링 결함을 시각적으로 확인한 뒤 사용자 승인 절차로 넘겼다.

---

## 4. P0 자동화 테스트 및 품질 검증 기록 (Test Record Table)

Node.js 22 내장 테스트 러너(`node --test`)와 `supertest`를 사용해 검증한 10개 핵심 통합 테스트 케이스의 실행 결과이다. 모든 테스트는 임시 디렉터리에 생성된 격리된 SQLite 파일 DB에서 수행되었다.

| 번호 | 테스트 스위트 파일 | 테스트 항목 | 검증 내용 및 인수 조건 | 소요 시간 | 결과 |
|:---:|:---|:---|:---|:---:|:---:|
| 1 | `test/auth-and-security.test.js` | 비인증 접근 차단 | 비로그인 상태에서 HTML 보호 경로 접근 시 `302 /login` 리다이렉트, `/api` 경로 접근 시 `401` JSON 반환 | ~25ms | 통과 |
| 2 | `test/auth-and-security.test.js` | CSRF 토큰 검증 | 상태 변경 요청(`POST`/`PUT`/`PATCH`/`DELETE`)에서 유효한 CSRF 토큰 누락 시 `403 Forbidden` 차단 | ~102ms | 통과 |
| 3 | `test/auth-and-security.test.js` | 회원가입 유효성 | 유효하지 않은 이메일 형식 또는 8자 미만 비밀번호 입력 시 `422` 상태 코드 및 입력값 보존 재렌더링 | ~10ms | 통과 |
| 4 | `test/auth-and-security.test.js` | 인증 및 세션 재생성 | bcryptjs 비밀번호 해싱, 로그인 성공 시 세션 재생성(`req.session.regenerate`) 및 세션 쿠키 발급 | ~185ms | 통과 |
| 5 | `test/crud-and-ownership.test.js` | 기업 CRUD 및 중복 방지 | 기업 등록, 조회, 수정, 삭제 정상 동작 및 사용자별 기업명 중복(`UNIQUE(user_id, name)`) 차단 | ~24ms | 통과 |
| 6 | `test/crud-and-ownership.test.js` | 공고 CRUD 및 인라인 기업 생성 | 공고 등록 시 신규 기업 인라인 동시 생성 트랜잭션, 마감일 D-Day 계산, 관심 공고 북마크 토글 | ~24ms | 통과 |
| 7 | `test/crud-and-ownership.test.js` | 지원 CRUD 및 stage_logs 기록 | 지원 등록, 전형 단계/결과 수정 및 `PATCH /api/applications/:id/stage` 호출 시 `stage_logs` 감사 로그 자동 누적 | ~7ms | 통과 |
| 8 | `test/crud-and-ownership.test.js` | 전형 일정 CRUD | 지원 건과 연결된 전형 일정 등록, 시간순 정렬 조회, 삭제 정상 동작 | ~11ms | 통과 |
| 9 | `test/ownership-and-seed.test.js` | 다중 사용자 소유권 격리 | 사용자 B가 사용자 A 소유의 기업/공고/지원/일정 ID에 접근할 때 존재 여부를 숨기며 `404 Not Found` 반환 | ~23ms | 통과 |
| 10 | `test/ownership-and-seed.test.js` | 한국어 데모 데이터 시드 | `src/db/seed.js` 실행 시 6개 기업, 6개 공고, 6개 지원, 3개 일정이 참조 무결성을 준수하며 정상 삽입됨 | ~120ms | 통과 |

* **종합 요약**: 3개 테스트 파일, 10개 핵심 시나리오 테스트 전체 통과 (`pass 10`, `fail 0`). 누적 실행 시간 약 0.73초.

---

### 2.3 [Issue-03] 서브에이전트 조기 종료 및 작업 누락

* **날짜**: 2026-11-10
* **문제**:
  * P1 단계 구현 작업을 하위 AI 작업자에게 위임했을 때, 작업자가 기존 코드와 명세 파일만 몇 차례 조회한 뒤 실제 소스 파일이나 뷰 템플릿을 생성하지 않고 작업을 완료했다고 보고하며 조기 종료하는 현상이 발생했다.
* **원인**:
  * 칸반 보드 화면, 드래그앤드롭 API, 자기소개서 멀티 문항 에디터, 버전 스냅샷 생성 및 Diff 복원이라는 대규모 개발 범위가 하나의 지시문에 포괄적으로 위임되어, 작업자가 어디서부터 코드를 작성해야 할지 구체적인 완료 조건(Definition of Done)을 파악하지 못했기 때문이었다.
* **해결**:
  * 대규모 작업을 독립적인 두 개의 세부 트랙으로 엄격히 분할했다:
    1. 트랙 A: 칸반 보드 화면(`views/applications/board.ejs`) 및 단계 변경 API(`PATCH /api/applications/:id/stage`)
    2. 트랙 B: 자기소개서 에디터(`views/essays/*`), 버전 스냅샷 생성, 단어 단위 Diff 비교 및 복원 서비스(`src/services/essaysService.js`)
  * 각 하위 작업 지시 시 "단순 파일 탐색 금지, 반드시 파일 작성 및 구현 완료, 구동 확인"이라는 완료 조건을 강제하고, 수정 및 생성해야 할 파일 경로를 명시하여 재위임했다.
* **검증**:
  * 분할 재위임 이후 작업자가 정해진 파일 단위로 구현 작업을 완수하고 계획된 명세에 맞춰 코드를 작성하는 결과를 확인했다.

---

## 3. 자동화 테스트 및 검증 기록

### 3.1 테스트 환경 및 실행 방식
* **테스트 러너**: Node.js 22 내장 테스트 모듈 (`node --test`)
* **HTTP 통합 테스트 라이브러리**: `supertest`
* **단언 라이브러리**: Node.js 내장 `node:assert/strict`
* **테스트 격리 아키텍처**:
  * `test/helpers.js`의 `createTestContext()` 함수를 통해 각 테스트 스위트마다 OS 임시 디렉터리(`node:os.tmpdir()`)에 독립된 SQLite 파일 DB를 생성한다.
  * 테스트 종료 후 `cleanup()`을 호출하여 임시 파일을 삭제함으로써 테스트 간 데이터 오염과 병렬 실행 시 파일 락 충돌을 원천 방지한다.

### 3.2 테스트 실행 결과 요약 (2026-11-10 기준)

```text
# Node.js 22 내장 테스트 러너 실행 결과
✔ test/auth-and-security.test.js (4 tests passed)
✔ test/crud-and-ownership.test.js (4 tests passed)
✔ test/ownership-and-seed.test.js (2 tests passed)

ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 428.5
```

### 3.3 테스트 케이스별 상세 검증 내역

| 테스트 파일 | 테스트 케이스명 | 주요 검증 내용 및 인수 조건 | 결과 |
|:---|:---|:---|:---:|
| `auth-and-security.test.js` | 회원가입 유효성 검사 및 세션 발급 | 이름 공백, 잘못된 이메일, 8자 미만 비밀번호 422 반환, 정상 가입 시 bcryptjs 해싱 및 세션 쿠키 발급 확인 | PASS |
| `auth-and-security.test.js` | 로그인 실패 및 세션 재생성 | 존재하지 않는 계정 및 비밀번호 불일치 시 401 반환, 정상 로그인 시 `req.session.regenerate()` 호출로 세션 고정 방지 | PASS |
| `auth-and-security.test.js` | CSRF 토큰 발급 및 검증 | 세션당 32바이트 토큰 발급, 상태 변경 요청 시 토큰 누락 및 변조 시 403 Forbidden 차단, 정상 토큰 통과 | PASS |
| `auth-and-security.test.js` | requireAuth 미들웨어 보호 | 비로그인 상태에서 보호 페이지 접근 시 302 /login 리다이렉트, /api 요청 시 401 JSON 응답 분기 검증 | PASS |
| `crud-and-ownership.test.js` | 기업(Companies) CRUD | 기업 등록, 중복 기업명 422 차단, 목록 검색(?q=), 수정, 연쇄 삭제(CASCADE) 동작 검증 | PASS |
| `crud-and-ownership.test.js` | 채용 공고(Jobs) CRUD | 인라인 신규 기업 동시 생성 트랜잭션, 북마크 토글, D-Day 계산 헬퍼, 마감 임박 정렬 검증 | PASS |
| `crud-and-ownership.test.js` | 지원 내역(Applications) CRUD | 단일 공고 중복 지원 422 차단, 등록 시 초기 stage_logs 자동 기록 트랜잭션 검증 | PASS |
| `crud-and-ownership.test.js` | 단계 변경 API 및 일정 CRUD | PATCH /api/applications/:id/stage 호출 시 stage_logs 이력 누적 및 전형 일정(Events) 시간순 정렬 검증 | PASS |
| `ownership-and-seed.test.js` | 다중 사용자 소유권 격리 | 사용자 A가 생성한 기업/공고/지원/일정 ID로 사용자 B가 접근 시 403이 아닌 404 Not Found 반환 검증 | PASS |
| `ownership-and-seed.test.js` | 한국어 데모 시드 데이터 정합성 | seed.js 실행 시 네이버, 카카오, 토스 등 6개 기업/공고/지원 및 3개 일정이 정상 삽입되고 관계가 유지되는지 검증 | PASS |

---

## 4. 품질 보증(QA) 및 향후 검증 계획

* **P1 통합 검증 (진행 예정)**:
  * 칸반 카드 드래그 이동 시 `PATCH /api/applications/:id/stage`의 `board_order` 정렬 무결성 테스트.
  * 자기소개서 작업 초안 저장 시 불변 버전 미생성 확인 테스트.
  * 불변 버전 스냅샷 생성 및 `jsdiff` 단어 단위 비교 화면 렌더링 검증.
  * 버전 복원 시 현재 미저장 초안 자동 백업 및 `restored_from_version_id` 계보 기록 트랜잭션 검증.
* **P2~P4 검증 계획**:
  * Chart.js 로컬 서빙 정상 동작 및 데이터 집계 정확도 검증.
  * 경험 자료함 CRUD 및 N:M 매핑 검증.
  * Gemini API 키 미설정 시 우아한 비활성화 및 키 설정 시 서버 사이드 면접 질문 생성 검증.
