> **최종 갱신 2026-11-10, 개발 진행 중, 최종본 아님**

# ReadySetJob 최종 프로젝트 보고서

## Git 커밋 타임라인

`git log --oneline` 기준 실제 커밋 이력이다. 모든 작업은 기능 및 검증 단위로 분할하여 커밋했다.

| 커밋 해시 | 분류 | 커밋 메시지 | 주요 작업 내용 |
|---|---|---|---|
| `4077b85` | `feat` | P0 Express/EJS/SQLite foundation with auth, CRUD, and tests | 기반 환경, 12개 테이블 스키마, 인증/세션, P0 핵심 CRUD |
| `5d4a7c1` | `docs` | add competitor research notes and UI design references | 국내외 9개 취업 플랫폼 분석 및 6대 UI 원칙 수립 |
| `460718b` | `docs` | add SPEC, ARCHITECTURE, DB_DESIGN, TASKS and design mockups A/B/C with screenshots | 기술 명세서 4종 및 A/B/C 디자인 시안 9종과 스크린샷 12장 |
| `8a2b2ae` | `feat` | kanban board drag-and-drop and essay editor with immutable versions | 6단계 칸반 보드 드래그앤드롭, 자소서 에디터, 불변 버전 스냅샷 및 비교 |
| `1370b14` | `feat` | dashboard statistics with Chart.js and materials library CRUD | 대시보드 KPI 집계, Chart.js 3종 차트 자체 서빙, 경험 자료함 CRUD |
| `4189b2a` | `fix` | harden session secret/cookies, block open redirects, strict date and id validation, consistent board ordering | Grok(Momus) 코드 리뷰 9건 수정 사항 반영 및 보안 강화 |
| `3d3c622` | `fix` | replace inline styles blocked by CSP with utility classes | Helmet CSP 차단 인라인 스타일을 CSS 유틸리티 클래스로 전환 |
| `471bf68` | `docs` | update task status for P2 and review fixes | 작업 진행 현황 및 변경 로그 갱신 |
| `f644920` | `feat` | interview questions with manual entry and server-side Gemini generation (disabled without API key) | 면접 질문 수동 관리 및 Gemini 연동(키 미설정 시 안전 비활성화) |
| `8278736` | `docs` | add living final report and full project README | 기말 최종 보고서 초안 및 상세 프로젝트 README 작성 |
| `22076c2` | `docs` | correct dashboard description in final report | 최종 보고서 대시보드 뷰 설명 정밀 보정 |

---

## 1. 프로젝트 개요

ReadySetJob은 개발자 취업 및 인턴십 준비생을 위한 전형 일정 추적 및 불변 버전 자기소개서 관리 웹 애플리케이션이다. 고급웹프로그래밍 기말 과제로 기획되었으며, 1인 개발 체제로 설계 및 구현을 진행하고 있다.

지원자가 여러 기업에 동시 다발적으로 지원할 때 발생하는 전형 일정 누락, 자기소개서 버전 혼선, 기업별 작성 내용 파편화 문제를 단일 시스템에서 체계적으로 관리하는 것을 목표로 한다. 외부 서비스 의존성을 최소화하고, Node.js와 내장 SQLite 엔진을 기반으로 경량화된 독립 실행형 아키텍처를 채택했다.

## 2. 개발 동기

취업 준비 과정에서 구직자는 평균 수십 곳의 채용 공고에 지원한다. 이 과정에서 다음과 같은 실질적인 문제점들이 반복된다.

1. **전형 일정과 공고 정보의 분실**: 채용 공고 웹페이지는 마감 후 비공개로 전환되는 경우가 많아 지원서 제출 후 본인이 어떤 직무 요건으로 지원했는지 확인하기 어렵다.
2. **자기소개서 버전 관리 실패**: 여러 기업에 유사한 문항을 변형하여 제출하면서 로컬 파일명(예: `자소서_최종_진짜최종.docx`) 기반 관리가 파편화되고, 이전 버전의 문장을 되살리거나 변경 내역을 대조하기 어렵다.
3. **상용 플랫폼의 제약과 프라이버시 문제**: 기존 구직 관리 서비스는 특정 채용 플랫폼에 종속되어 있거나, 무거운 SaaS 구독 모델을 요구하며, 개인적인 경험과 지원 이력이 외부 클라우드에 노출되는 부담이 존재한다.

ReadySetJob은 사용자가 자신의 로컬 또는 단일 서버 환경에서 완전한 데이터 소유권을 유지하면서, 직관적인 6단계 칸반 보드와 Git 커밋 개념을 차용한 불변 자기소개서 버전 관리 시스템을 제공하기 위해 개발을 시작했다.

## 3. 주요 기능 (모듈별 상태)

ReadySetJob의 모든 기능은 "문서 작성 완료 ≠ 기능 완료"라는 원칙에 따라 계획, 개발 중, 구현 완료, 검증 완료의 4단계로 관리한다.

| 모듈 | 세부 기능 | 주요 내용 | 진행 상태 |
|:---|:---|:---|:---:|
| 인증 및 보안 | 회원가입 및 로그인 | bcryptjs(cost 10) 해싱, 세션 고정 공격 방지용 세션 재생성 | 검증 완료 |
| 인증 및 보안 | 접근 제어 및 보호 | requireAuth 미들웨어, crypto.timingSafeEqual 기반 CSRF 방어 | 검증 완료 |
| 인증 및 보안 | 다중 사용자 격리 | 모든 SQL 쿼리에 user_id 바인딩, 타인 리소스 접근 시 404 반환 | 검증 완료 |
| 기업 및 공고 | 기업 관리 | 기업 CRUD, 사용자별 기업명 중복 방지(UNIQUE), 메모 기록 | 검증 완료 |
| 기업 및 공고 | 채용 공고 관리 | 공고 등록 시 인라인 기업 생성 트랜잭션, 북마크 토글, D-Day 계산 | 검증 완료 |
| 지원 및 칸반 | 지원 현황 CRUD | 지원 등록, 전형 단계 및 결과 분리, 1개 공고당 1회 지원 제약 | 검증 완료 |
| 지원 및 칸반 | 6단계 칸반 보드 | 서류부터 최종까지 6단계 카드 배치, HTML5 드래그앤드롭 및 키보드 이동 | 검증 완료 |
| 지원 및 칸반 | 전형 변경 감사 | PATCH 요청 시 트랜잭션 기반 순서 재정렬 및 stage_logs 이력 누적 | 검증 완료 |
| 전형 일정 | 일정 추적 | 지원 건과 연결된 서류 마감, 코테, 면접 일정 CRUD 및 시간순 정렬 | 검증 완료 |
| 자기소개서 | 멀티 문항 작성기 | 공고별 자소서 문항 추가/삭제/순서변경, 글자수 카운터, 초안 실시간 저장 | 검증 완료 |
| 자기소개서 | 불변 버전 관리 | 스냅샷 기반 버전 생성(수정 불가), jsdiff 단어 단위 대조 화면 | 검증 완료 |
| 자기소개서 | 이력 보존 복원 | 복원 전 미저장 초안 자동 백업 및 복원 출처(계보) 기록 신규 버전 생성 | 검증 완료 |
| 자기소개서 | 경험 자료 연계 | 과거 문항 검색 API(/api/essays/search), 경험 자료함 N:M 연결 | 검증 완료 |
| 대시보드 | 통계 및 시각화 | 단계별 깔때기 분석, 합불 도넛 차트, 월별 추이, Chart.js 로컬 서빙 | 검증 완료 |
| 경험 자료함 | 스펙 및 활동 정리 | 경험/프로젝트/수상/대외활동 CRUD, 태그 필터링, 키워드 검색 | 검증 완료 |
| AI 어시스턴트 | 면접 질문 생성 | 수동 질문 CRUD 및 Gemini API 기반 직무/자소서 맞춤 예상 질문 도출 | 구현 완료 (실호출 미검증) |
| AI 어시스턴트 | 안전한 비활성화 | API 키 미설정 시 버튼 비활성화 안내, 모의 응답 없는 투명한 동작 | 검증 완료 |
| 디자인 시스템 | 일관된 UI 적용 | A/B/C 시안 중 사용자 승인 시안 채택 및 전 화면 토큰 적용 | 개발 중 (승인 대기) |

## 4. 기술 스택

외부 상주 프로세스나 복잡한 빌드 도구 없이 단일 노드 런타임에서 온전히 동작하도록 경량 스택을 선정했다.

| 분류 | 기술 및 라이브러리 | 버전 | 선정 이유 |
|:---|:---|:---|:---|
| 런타임 | Node.js | v22.14.0 LTS | 최신 안정화 LTS 버전, 내장 테스트 러너(`node --test`) 활용 |
| 웹 프레임워크 | Express | ^4.21.2 | 간결하고 안정적인 HTTP 라우팅 및 검증된 미들웨어 생태계 |
| 템플릿 엔진 | EJS | ^3.1.10 | 서버 사이드 렌더링을 통한 초기 렌더 속도 보장 및 SEO 친화적 마크업 |
| 데이터베이스 | SQLite 3 (`better-sqlite3`) | ^11.5.0 | C++ 네이티브 동기식 바인딩, 트랜잭션 격리, 파일 기반 무설치 운영 |
| 세션 저장소 | `better-sqlite3-session-store` | ^0.1.0 | 동일 SQLite 파일 내 세션 저장, 외부 메모리 DB(Redis 등) 불필요 |
| 보안 라이브러리 | `bcryptjs`, `helmet` | ^3.0.2 / ^8.0.0 | 안전한 단방향 암호화 해싱 및 HTTP 보안 헤더(CSP 포함) 강제 |
| 텍스트 차이 분석 | `diff` (jsdiff) | ^7.0.0 | 자소서 버전 간 단어 단위(word-level) 정밀 비교 및 HTML 이스케이프 |
| 데이터 시각화 | Chart.js | ^4.4.6 | npm 설치 후 `/vendor`로 로컬 정적 서빙, 외부 CDN 의존 차단 |
| 테스트 도구 | `supertest`, `node:test` | ^7.0.0 / 내장 | 별도 테스팅 프레임워크(Jest 등) 없이 빠른 속도의 통합 테스트 수행 |
| 인공지능 API | Google Gemini REST API | gemini-2.5-flash | 서버 사이드 fetch 호출, 표준 JSON 스키마 기반 면접 질문 추출 |

## 5. 시스템 구조

ReadySetJob은 전형적인 3계층 아키텍처(Presentation - Business Logic - Data Access)를 따르며, 각 계층 간 책임을 명확히 격리했다.

```text
[ 브라우저 (클라이언트) ]
    │
    ├── HTML/EJS 폼 전송 (POST, PUT, DELETE + CSRF 토큰)
    └── 비동기 Fetch 요청 (PATCH 보드 이동, PUT 초안 저장, AI 생성)
    │
    ▼
[ Express 미들웨어 계층 ]
    ├── helmet (CSP, X-Content-Type-Options 등 보안 헤더)
    ├── express-session (SQLite 기반 세션 관리, session.regenerate)
    ├── csrfProtection (crypto.timingSafeEqual 기반 상수 시간 검증)
    ├── requireAuth (비인증 요청 302 리다이렉트 또는 401 JSON 분기)
    └── validation (입력값 검증, safeRedirectPath 오픈 리다이렉트 방어)
    │
    ▼
[ 라우터 계층 (src/routes/) ]
    ├── auth, companies, jobs, applications, events, essays, materials, dashboard, ai
    └── HTTP 요청 파싱, 권한 확인, 서비스 계층 호출, 뷰 렌더링/JSON 응답
    │
    ▼
[ 서비스 계층 (src/services/) ]
    ├── 비즈니스 규칙 처리, 입력 데이터 가공, 트랜잭션 조율
    ├── applicationsService (보드 재정렬, stage_logs 감사 기록)
    ├── essaysService (불변 버전 생성, jsdiff 비교, 이력 보존 복원)
    └── aiService (Gemini API 통신, 속도 제한, 응답 검증)
    │
    ▼
[ 데이터베이스 계층 (SQLite WAL) ]
    ├── better-sqlite3 (PRAGMA journal_mode = WAL, foreign_keys = ON)
    └── 12개 도메인 테이블 + 14개 인덱스 (사용자별 완전 격리)
```

## 6. DB 설계

ReadySetJob의 데이터베이스는 `better-sqlite3` 드라이버를 통해 로컬 SQLite 파일(`data/readysetjob.db`)로 관리된다. 모든 연결은 `PRAGMA journal_mode = WAL;`과 `PRAGMA foreign_keys = ON;`을 강제하여 동시성 처리 성능을 높이고 외래키 참조 무결성을 보장한다.

### 6.1 핵심 테이블 구성 요약 (12개 테이블)

1. `users`: 사용자 계정 (이메일 고유키, bcryptjs 해시 비밀번호)
2. `companies`: 사용자가 등록한 관심 및 지원 기업 (`UNIQUE(user_id, name)`)
3. `job_posts`: 채용 공고 (기업 참조, 마감일, 직무, 근무 형태, 북마크)
4. `applications`: 지원 현황 (`job_post_id` 1:1 유일 제약, 전형 단계 `stage`, 결과 `result`, 보드 순서 `board_order`)
5. `stage_logs`: 전형 단계 및 결과 변경 감사 로그 (변경 전후 단계 및 결과 타임스탬프 기록)
6. `events`: 지원 건별 전형 일정 (서류 마감, 코딩테스트, 면접, 결과 발표 등)
7. `essays`: 자기소개서 문서 헤더 (지원 건 연결 `ON DELETE SET NULL`)
8. `essay_questions`: 자기소개서 실시간 작성 초안 문항 (순서, 문항, 글자수 제한, 답변)
9. `essay_versions`: 불변 버전 스냅샷 (`version_no`, 레이블, 문항 스냅샷 JSON, 복원 출처 `restored_from_version_id`)
10. `materials`: 경험 자료함 (경험, 프로젝트, 수상, 대외활동, 기타 분류 및 태그)
11. `essay_materials`: 자기소개서와 경험 자료 간의 N:M 매핑 테이블
12. `interview_questions`: 지원 공고 및 자소서 기반 예상 면접 질문 (수동 등록 및 AI 생성 질문)

### 6.2 주요 설계 의사결정

* **단계(stage)와 결과(result)의 분리**: 서류, 코딩테스트, 면접 등 전형 단계와 진행중, 합격, 불합격, 지원취소 등 전형 결과를 서로 다른 컬럼으로 분리하여 파이프라인 집계와 상태 표현의 모호성을 제거했다.
* **자기소개서 스냅샷 불변성 보장**: `essay_versions` 테이블의 레코드는 생성 후 절대 수정되지 않는다. 복원 시에도 기존 버전을 덮어쓰는 대신 복원 출처를 명시한 신규 버전을 생성하여 감사 추적성을 확보했다.
* **사용자별 소유권 격리**: 모든 주요 테이블은 `user_id`를 외래키로 가지며, 복합 인덱스(`user_id`, `updated_at` 등 총 14개 인덱스)를 통해 빠른 조회와 데이터 격리를 동시에 달성했다.

자세한 ERD 다이어그램과 DDL 스키마, 인덱스 명세는 `docs/DB_DESIGN.md`를 참조한다.

## 7. 화면별 구현 내용

현재 구현된 모든 라우트와 뷰는 기능 및 비즈니스 로직 검증을 목적으로 `public/css/tokens.css`의 기본 변수를 사용하는 중립 스타일(Neutral Scaffold)로 렌더링된다. 사용자가 A/B/C 디자인 시안 중 최종안을 승인하면 Phase P3에서 정식 디자인 시스템(`docs/DESIGN_SYSTEM.md`)을 전 화면에 반영할 예정이다.

* **인증 화면 (`/login`, `/signup`)**: 이메일 및 비밀번호 유효성 검사, 실패 시 입력값 보존 및 오류 배너 노출, 회원가입 완료 후 자동 로그인 및 세션 재생성을 지원한다.
* **대시보드 (`/dashboard`)**: 상단 KPI 카드(전체 지원, 진행 중 전형, 합격, 불합격·지원취소, 관심 기업 등), 진행 중 전형 단계별 분포 막대 차트, 합격/불합격 도넛 차트, 월별 지원 추이 선 그래프, 14일 이내 마감 임박 공고 및 다가오는 일정 목록을 제공한다. Chart.js 스크립트는 npm 패키지에서 정적 서빙된다.
* **기업 관리 (`/companies`)**: 등록된 기업 목록 조회, 기업명 검색, 신규 기업 등록 및 메모 수정을 지원한다.
* **채용 공고 관리 (`/jobs`)**: 지원 여부 및 마감일 D-Day 배지 표시, 관심 공고 북마크 토글, 공고 등록 시 신규 기업 인라인 즉시 생성 모달을 제공한다.
* **지원 현황 목록 및 상세 (`/applications`, `/applications/:id`)**: 공고별 지원 내역 목록, 상세 화면 내 전형 이력 타임라인, 연결된 전형 일정 목록, 작성된 자기소개서 바로가기, 예상 면접 질문 섹션을 통합 제공한다.
* **칸반 보드 (`/applications/board`)**: 서류, 코딩테스트, 과제, 1차 면접, 2차 면접, 최종 등 6개 전형 단계를 열 단위로 구성했다. HTML5 드래그앤드롭과 키보드 조작, 자바스크립트 비활성화 환경을 위한 HTML 폼 폴백을 모두 갖추었다.
* **전형 일정 관리 (`/events`)**: 전체 지원 기업의 서류 마감, 코딩테스트, 면접 일정을 시간순으로 정렬하여 표시하고 추가/삭제를 지원한다.
* **자기소개서 작성 및 버전 관리 (`/essays`, `/essays/:id`)**: 복수 문항 추가/삭제/순서 이동, 공백 포함 및 제외 실시간 글자수 카운터, 자동 초안 저장(Ctrl+S), 불변 버전 스냅샷 생성, 두 버전 간 단어 단위 jsdiff 대조 뷰(`compare.ejs`), 안전한 복원 기능을 제공한다.
* **경험 자료함 (`/materials`)**: 프로젝트, 수상, 인턴 경험 등을 키워드 및 태그별로 정리하고 자기소개서 작성 시 즉시 연계할 수 있도록 지원한다.

## 8. 핵심 코드 및 구현 방법

### 8.1 칸반 보드 단계 이동 및 순서 압축 트랜잭션 (`src/services/applicationsService.js`)

카드를 다른 전형 단계로 이동할 때 이전 컬럼과 대상 컬럼의 순서(`board_order`)를 0부터 n-1까지 연속된 정수로 재정렬하고 `stage_logs`에 감사 로그를 남긴다.

```javascript
    if (oldStage !== nextStage) {
      const oldSiblings = selectColumnStmt.all(uid, oldStage, existing.id);
      for (let i = 0; i < oldSiblings.length; i += 1) {
        updateOrderStmt.run(i, oldSiblings[i].id, uid);
      }
    }

    const targetSiblings = selectColumnStmt.all(uid, nextStage, existing.id);
    const hasIndex = toIndex !== undefined && toIndex !== null && toIndex !== '' && !Number.isNaN(Number(toIndex));
    const clampedIndex = hasIndex
      ? Math.max(0, Math.min(targetSiblings.length, Math.trunc(Number(toIndex))))
      : targetSiblings.length;

    targetSiblings.splice(clampedIndex, 0, { id: existing.id });

    db.prepare("UPDATE applications SET stage = ?, result = ?, board_order = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(nextStage, nextResult, clampedIndex, existing.id, uid);

    for (let i = 0; i < targetSiblings.length; i += 1) {
      updateOrderStmt.run(i, targetSiblings[i].id, uid);
    }
```

### 8.2 자기소개서 불변 스냅샷 생성 및 이력 보존 복원 (`src/services/essaysService.js`)

현재 에디터의 모든 문항과 답변을 JSON으로 직렬화하여 불변 버전으로 생성한다. 복원 시에도 기존 버전을 덮어쓰지 않고 미저장분을 백업한 뒤 복원 출처(`restored_from_version_id`)를 기록한 새 버전을 발행한다.

```javascript
// 불변 버전 스냅샷 생성 (MAX(version_no) + 1 자동 부여)
const createEssayVersion = (db, userId, { essayId, label = '' }) => {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const snapshotItems = buildSnapshotItems(getEssayQuestions(db, essay.id));
  const created = db.transaction(() => insertVersionSnapshot(db, {
    essayId: essay.id, label: String(label || '').trim() || '버전 스냅샷',
    snapshotItems, restoredFromVersionId: null
  }))();
  return { ...created, snapshot: parseSnapshotJson(created.snapshot_json) };
};

// 버전 복원 트랜잭션 (미저장분 백업 및 계보 기록 신규 버전 발행)
const backupVersion = !latestRow || draftsDiffer(currentItems, latestSnapshot)
  ? insertVersionSnapshot(db, { essayId: essay.id, label: '복원 전 자동 저장', snapshotItems: currentItems })
  : null;
const restoredVersion = insertVersionSnapshot(db, {
  essayId: essay.id, label: `v${targetVersion.version_no}에서 복원`,
  snapshotItems: buildSnapshotItems(getEssayQuestions(db, essay.id)),
  restoredFromVersionId: targetVersion.id
});
```

### 8.3 상수 시간 CSRF 토큰 검증 미들웨어 (`src/middleware/csrf.js`)

세션별로 32바이트 난수 토큰을 발행하고, 상태 변경 요청 시 타이밍 공격을 방어하기 위해 `crypto.timingSafeEqual`로 검증한다.

```javascript
function tokensMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function csrfProtection(req, res, next) {
  const token = ensureCsrfToken(req);
  res.locals.csrfToken = token;
  if (SAFE_METHODS.has(req.method)) return next();

  const submitted =
    (req.body && typeof req.body._csrf === 'string' && req.body._csrf) ||
    req.get('X-CSRF-Token') ||
    req.get('x-csrf-token') ||
    '';

  if (!tokensMatch(token, submitted)) {
    if (req.originalUrl.startsWith('/api')) {
      return res.status(403).json({ error: '유효하지 않은 CSRF 토큰입니다.' });
    }
    return res.status(403).render('error', { title: '보안 토큰 오류 (403)', status: 403, message: '유효하지 않은 CSRF 토큰입니다.' });
  }
  return next();
}
```

### 8.4 안전한 리다이렉트 경로 검증 (`src/middleware/validation.js`)

외부 악성 도메인으로의 오픈 리다이렉트 공격 및 프로토콜 변조 공격을 차단하기 위해 엄격한 정규식과 문자열 검사를 수행한다.

```javascript
function safeRedirectPath(value, fallback = '/') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (
    !SAFE_REDIRECT_REGEX.test(trimmed) ||
    trimmed.includes('://') ||
    trimmed.includes('\\') ||
    CONTROL_CHARS_REGEX.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}
```

### 8.5 헤더 기반 API 키 전달 및 JSON 배열 검증 (`src/services/aiService.js`)

URL 쿼리 스트링에 키를 노출하지 않고 `x-goog-api-key` 헤더를 통해 Gemini API를 호출하며, 수신된 응답의 JSON 구조를 방어적으로 검증한다.

```javascript
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  let parsed;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    throw new AiError('AI 응답이 유효한 JSON 형식이 아닙니다.', 502);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AiError('AI 응답이 올바른 면접 질문 배열 형식이 아닙니다.', 502);
  }
```

## 9. 발생한 문제와 해결 과정

ReadySetJob 개발 과정에서 발생한 실제 기술적 문제와 해결 내역이다.

### 9.1 better-sqlite3-session-store 만료 타이머로 인한 테스트 무한 대기
* **문제**: `npm test`(`node --test`) 실행 시 모든 테스트 단언이 통과했음에도 프로세스가 종료되지 않고 무한 대기(Hang) 상태에 빠졌다.
* **원인**: `better-sqlite3-session-store` 패키지 내부에서 세션 만료 처리를 위해 15분 주기 `setInterval` 타이머를 실행하고 있었으나, 타이머 객체에 `timer.unref()`가 호출되지 않아 Node.js 이벤트 루프가 종료를 대기했다.
* **해결**: `src/app.js`에서 원본 스토어를 상속한 `UnrefSqliteSessionStore` 클래스를 정의하고, `startInterval()` 실행 직후 생성된 내부 타이머에 `timer.unref()`를 호출하도록 수정했다.

### 9.2 대용량 단일 문서 작성 시 AI 도구 타임아웃
* **문제**: 계획서 및 기술 명세서 등 300줄 이상의 문서를 한 번에 파일 쓰기 도구로 생성할 때 모델 응답이 멈추거나 타임아웃이 발생했다.
* **원인**: 컨텍스트 버퍼 출력 한도와 도구 실행 시간 제한으로 인한 병목이었다.
* **해결**: 200줄 미만 초기 생성 후 edit 도구를 활용한 점진적 분할 추가(Chunked Writing) 전략으로 전환하여 내용 유실 없이 대용량 문서를 완성했다.

### 9.3 서브에이전트 파일 탐색 후 조기 종료
* **문제**: P1 단계(칸반 및 자소서 버전 관리) 작업을 하위 작업자에게 일괄 위임했을 때 코드 작성 없이 파일 탐색만 수행한 뒤 조기 종료했다.
* **원인**: 칸반 보드와 자소서 버전 관리라는 광범위한 요구사항이 한 프롬프트에 묶여 완료 조건이 모호했다.
* **해결**: 작업을 칸반 보드 트랙과 자소서 에디터 트랙으로 명확히 분할하고, 단순 분석을 넘어 반드시 대상 소스 파일과 뷰를 생성 및 수정하여 테스트를 통과할 것을 명시해 완수했다.

### 9.4 Gemini Argon 쿼터 소진과 Gemini Flash 자동 폴백
* **문제**: 고속 구현 및 목업 제작 과정에서 Gemini 2.5 Argon 모델의 분당 요청 쿼터가 소진되는 한계에 도달했다.
* **원인**: 일시적인 모델 요청 급증으로 인한 API Rate Limit 발생이었다.
* **해결**: 에이전트 런타임에 설정된 자동 폴백 정책에 따라 Gemini 2.5 Flash 모델로 즉시 전환되어 파이프라인 중단 없이 구현 작업을 지속했다.

### 9.5 Notion MCP 인증 만료와 로컬 백업
* **문제**: Notion MCP를 통한 원격 문서 동기화 시도 중 인증 만료(Unauthorized) 오류가 발생하여 원격 동기화가 차단되었다.
* **원인**: 외부 통합 인증 토큰 갱신 주기 만료 때문이었다.
* **해결**: 외부 플랫폼 장애가 전체 프로젝트 진행을 막지 않도록 `docs/notion/*.md` 디렉터리에 로컬 백업 마크다운을 구축하고 이를 진실 공급원(Single Source of Truth)으로 삼아 독립성을 확보했다.

### 9.6 Grok(Momus) 코드 리뷰 9건 수정 사항 반영
독립적인 코드 리뷰를 거쳐 보안과 데이터 무결성 관련 9가지 지적 사항을 전면 수정했다.
1. **Fix 1 (SESSION_SECRET 필수화)**: 프로덕션 환경(`NODE_ENV=production`)에서 시크릿 미설정 시 서버 시작을 즉시 차단(throw)하고 개발 환경은 안전 fallback을 유지하도록 보강했다.
2. **Fix 2 (세션 쿠키 보안 강화)**: 프로덕션 환경에서 `cookie.secure: true` 및 `trust proxy: 1`을 적용하고, 로그아웃 시 동일한 보안 옵션으로 세션 쿠키를 삭제했다.
3. **Fix 3 (오픈 리다이렉트 방지)**: `safeRedirectPath` 헬퍼를 도입하여 외부 도메인, 스키마 없는 프로토콜(`//evil.com`), 역슬래시(`/\\evil.com`), 제어문자가 포함된 리다이렉트를 차단했다.
4. **Fix 4 (엄격한 달력 날짜 검증)**: 정규식을 넘어 윤년과 일수를 계산하는 `isValidDate`, `isValidDateTime`을 구현하여 2월 31일 등의 비정상 일시 입력을 422로 차단했다.
5. **Fix 5 (칸반 순서 조밀 압축)**: `PUT` 단계 이동 및 삭제 시 이전 컬럼과 대상 컬럼의 `board_order`를 빈틈없이 0부터 n-1까지 재정렬하여 순서 누수를 방지했다.
6. **Fix 6 (비정수 보드 순서 차단)**: `PATCH /api/applications/:id/stage`에 문자열이나 소수점 `board_order`가 들어올 경우 422로 거부하도록 유효성 검사를 강화했다.
7. **Fix 7 (자소서 서비스 소유권 검증)**: `createEssay`, `saveEssayDraft` 트랜잭션 내에서 지정한 `application_id`가 실제 로그인 사용자 소유인지 검증하여 타인 지원서 연결 시 404를 반환했다.
8. **Fix 8 (정수 ID 파싱 헬퍼 parseId)**: 숫자가 아닌 URL 파라미터(`abc` 등)나 boolean 값에 대해 서버 500 에러를 내지 않고 404를 반환하도록 안전하게 파싱했다.
9. **Fix 9 (가입 이메일 경합 처리)**: 회원가입 시 동시성으로 인한 `SQLITE_CONSTRAINT_UNIQUE` 발생 시 500 에러 대신 422("이미 사용 중인 이메일입니다")로 사용자에게 안내했다.

### 9.7 Helmet CSP 인라인 스타일 차단과 유틸리티 클래스 전환
* **문제**: Helmet의 콘텐츠 보안 정책(CSP)으로 인해 EJS 템플릿의 인라인 `style="..."` 속성이 브라우저 콘솔에서 차단 오류를 일으켰다.
* **원인**: unsafe-inline 스타일을 허용하지 않는 보안 정책 때문이었다.
* **해결**: `public/css/app.css`에 텍스트 정렬, 너비, 여백 등 유틸리티 클래스를 정의하고 템플릿의 인라인 스타일을 클래스로 교체하여 브라우저 콘솔 오류 0건을 달성했다.

### 9.8 Playwright 드래그 테스트 타깃 화면 밖 오류 해결
* **문제**: 칸반 보드 E2E 테스트 중 우측 끝 열로 카드를 드래그할 때 마우스 좌표가 빗나가 드래그앤드롭이 실패했다.
* **원인**: 6개 컬럼이 뷰포트 너비를 초과하여 화면 밖(off-screen)에 위치해 좌표 계산이 어긋났다.
* **해결**: 브라우저 뷰포트 너비를 1440px로 확장하고 드래그 타깃 컬럼을 뷰포트 안으로 스크롤(`scrollIntoView`)하는 보정 로직을 테스트 하네스에 추가했다.

---

## 10. 실제 테스트 결과

프로젝트의 신뢰성을 입증하기 위해 작성된 전체 자동화 테스트를 직접 실행했다.

### 10.1 npm test 자동화 테스트 실행 결과 (2026-11-10 기준)

Node.js 22 내장 테스트 러너(`node --test`)와 `supertest`를 이용해 11개 테스트 스위트, 50개 테스트 케이스를 실행한 결과이다.

```text
# 실행 명령: npm test (node --test test/)
✔ Auth, Session, requireAuth, and CSRF Security (4 tests)
✔ Companies, Job Posts, Applications, and Events CRUD (4 tests)
✔ Ownership Isolation and Korean Demo Seed (2 tests)
✔ Kanban Board (/applications/board) & Stage Reordering API (5 tests)
✔ Essays CRUD, Draft Save, Questions, Search, and Ownership (6 tests)
✔ Essay Versions: Immutability, Compare, Restore, and Security (4 tests)
✔ Dashboard (/dashboard & /api/dashboard/stats) (3 tests)
✔ Materials (/materials) CRUD, Validation, Ownership, CSRF, Search (5 tests)
✔ Code Review Fixes (Part 1: Fixes 1-4) (4 tests)
✔ Code Review Fixes (Part 2: Fixes 5-9) (5 tests)
✔ Interview Questions Feature (8 tests)

ℹ tests 50
ℹ suites 11
ℹ pass 50
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### 10.2 테스트 스위트별 검증 범위

| 파일명 | 테스트 수 | 주요 검증 내용 |
|---|:---:|---|
| `test/auth-and-security.test.js` | 4 | 비인증 302/401 분기, CSRF 토큰 누락 403 차단, 가입 입력 검증, bcryptjs 및 세션 재생성 |
| `test/crud-and-ownership.test.js` | 4 | 기업 CRUD 및 중복 방지, 공고 인라인 기업 생성, 지원 내역 및 stage_logs 기록, 일정 CRUD |
| `test/ownership-and-seed.test.js` | 2 | 타 사용자 리소스 접근 시 404 차단(존재 은닉), 한국어 데모 시드 데이터 정합성 |
| `test/board.test.js` | 5 | 6개 전형 컬럼 렌더링, PATCH 순서 재정렬, 컬럼 내 순서 보존, 400/404/422 검증, no-JS 폴백 |
| `test/essays.test.js` | 6 | 자소서 CRUD, 초안 저장(버전 미생성), CSRF 검증, 문항 이동/수정, 과거 문항 검색, 소유권 격리 |
| `test/essay-versions.test.js` | 4 | 불변 스냅샷 생성, jsdiff 단어 단위 비교 및 XSS 차단, 이력 보존 복원, 타인 버전 접근 차단 |
| `test/dashboard.test.js` | 3 | KPI 집계 및 소유권 격리, HTML 내 차트 JSON 주입, XSS 방지 특수문자 이스케이프 |
| `test/materials.test.js` | 5 | 경험 자료함 CRUD, 입력값 유효성(422), 소유권 격리(404), CSRF 차단, 태그 및 키워드 검색 |
| `test/review-fixes.test.js` | 4 | 코드 리뷰 1~4 (SESSION_SECRET 필수, secure 쿠키, 오픈 리다이렉트 방어, 엄격한 날짜 검증) |
| `test/review-fixes-2.test.js` | 5 | 코드 리뷰 5~9 (순서 압축, 비정수 순서 차단, 자소서 지원서 소유권 검증, parseId, 가입 경합 422) |
| `test/interview-questions.test.js` | 8 | 면접 질문 수동 CRUD, 소유권 격리, CSRF 검증, AI 비활성화, 스텁 API 호출, 잘못된 응답 거부, 속도 제한 |

### 10.3 실제 브라우저 인터랙션 시나리오 검증

헤드리스 브라우저 환경에서 실제 사용자 시나리오를 구동하여 검증했다.

1. **칸반 카드 드래그 이동**: 카드를 서류 컬럼에서 코딩테스트 컬럼으로 드래그 이동 시 `PATCH /api/applications/:id/stage`가 200 성공을 반환했다. 페이지 새로고침 후에도 이동된 컬럼과 `board_order` 순서가 영구 유지됨을 확인했다.
2. **에디터 초안 실시간 저장**: 자소서 에디터에서 문항을 작성하고 Ctrl+S를 입력했을 때 버전 생성 없이 `PUT /api/essays/:id/draft`로 저장되었으며, 새로고침 후에도 입력 내용이 그대로 보존되었다.
3. **브라우저 콘솔 오류**: CSP 헤더 위반이나 자바스크립트 런타임 오류 없이 콘솔 에러 0건을 유지했다.
4. **AI 면접 질문 실호출 상태**: API 키가 없는 환경에서는 비활성화 배너가 정상 표시되었고, 테스트 스위트에서는 스텁 fetch를 통해 요청 헤더와 응답 검증을 마쳤다. 단, 실제 과금 API 키를 사용한 외부 통신은 비용 관리상 미검증 상태이다.

## 11. AI 활용 내용

ReadySetJob 개발 과정에서는 AI를 단순 보조 도구가 아닌 체계적인 멀티 에이전트 협업 파이프라인으로 운용했다.

* **오케스트레이션 런타임**: OpenCode 런타임 및 oh-my-opencode 멀티 에이전트 프레임워크를 기반으로 각 모델의 강점을 극대화했다.
* **Claude Opus (지휘 및 아키텍처 수립)**: 전체 P0~P4 단계별 로드맵 기획, 보안 및 트랜잭션 아키텍처 설계, 작업 분할 및 완료 기준(DoD) 수립, 최종 코드 병합 및 Git 커밋을 총괄했다.
* **Gemini 작업자 (구현 및 문서화)**: Express 라우터와 better-sqlite3 서비스 로직 작성, EJS 뷰 마크업, 정적 HTML 목업 9종(A/B/C) 제작, 대용량 기술 문서를 작성했다. 고성능 Argon 모델의 쿼터 소진 시 빠른 속도의 Flash 모델(`gemini-2.5-flash`)로 유연하게 전환하여 업무 연속성을 유지했다.
* **Grok / Momus (적대적 코드 리뷰어)**: 구현 완료된 코드에 대해 공격자 관점에서 보안 취약점과 경합 조건을 분석하여 세션 보안, 오픈 리다이렉트, 동시성 경합 등 9가지 핵심 개선 사항을 찾아내고 시스템을 견고하게 보강했다.
* **Perplexity MCP (실시간 경쟁사 조사)**: Huntr, Teal, Simplify, 자소설닷컴 등 국내외 9개 구직 서비스의 최신 유료 요금제와 기능 명세를 실시간 교차 검증하여 `docs/RESEARCH_NOTES.md`에 체계적으로 집약했다.
* **Notion MCP (협업 로그 관리)**: 개발 일지와 기술 문서를 구조화하고 Notion 워크스페이스 연동을 시도했으며, 인증 장애 시 로컬 마크다운 백업으로 기민하게 전환했다.
* **인간 및 자동화 검증 원칙**: AI가 생성한 모든 산출물은 `node --test` 50개 테스트를 통과하고 브라우저 실제 구동을 확인한 후에만 브랜치에 반영하는 엄격한 품질 원칙을 견지했다.

## 12. 최종 성과 (2026-11-10 기준)

2026년 11월 10일 현재 기준 ReadySetJob 프로젝트의 실증적 성과는 다음과 같다.

1. **기반 인프라 및 핵심 CRUD 완성 (Phase P0)**: Node.js 22, Express 4, SQLite(`better-sqlite3`), 세션 저장소, `bcryptjs` 인증 및 CSRF 방어 기반 위에 기업, 채용 공고, 지원 현황, 일정 관리 CRUD를 완성하고 `user_id` 기반 소유권 격리를 100% 확립했다.
2. **인터랙티브 칸반 보드 및 자소서 버전 관리 (Phase P1)**: 6단계 전형 칸반 보드(HTML5 드래그앤드롭, 키보드 조작, no-JS 폼 폴백, 연속 번호 압축 재정렬)와 다중 문항 자소서 에디터, 불변 스냅샷 생성, 서버 사이드 `jsdiff` 단어 단위 대조 뷰, 복원 출처를 보존하는 안전한 버전 복원 시스템을 구축했다.
3. **통계 시각화 및 경험 자료함 (Phase P2)**: npm 설치 기반 Chart.js 로컬 서빙을 통해 단계별 깔때기 분석, 합불 도넛 차트, 월별 지원 추이 차트를 구현하고, 프로젝트 및 대외활동을 관리하는 경험 자료함을 자소서와 연결했다.
4. **AI 면접 예상 질문 시스템 (Phase P4 구현 완료)**: 지원 공고와 자소서 답변을 분석하여 면접 질문을 추출하는 Gemini REST 통신 계층과 10분당 5회 속도 제한을 구현했다. API 키 미설정 시 버튼을 비활성화하고 정직한 안내를 제공하도록 처리했다.
5. **품질 및 안정성 지표**: 총 11개 테스트 파일, 50개 테스트 케이스 전원 통과(`pass 50`, `fail 0`), 실행 시간 약 2.09초, 브라우저 콘솔 오류 0건, Momus 코드 리뷰 9대 취약점 100% 개선 조치를 완료했다.
6. **디자인 시안 3종 및 스크린샷 완비**: Linear 스타일(A안), Huntr 스타일(B안), Craft 스타일(C안)의 정적 HTML 목업 9종과 데스크톱/모바일 스크린샷 12장을 완성하여 사용자 최종 승인을 준비했다.

## 13. 개선점 및 한계

현재 시스템은 핵심 기능과 보안 검증을 충실히 통과했으나, 다음과 같은 기술적 한계와 개선 과제를 안고 있다.

1. **디자인 시스템 전면 적용 대기 (Phase P3 과제)**: 현재의 EJS 뷰 화면들은 비즈니스 로직과 데이터 정합성을 검증하기 위한 중립적 스캐폴딩 스타일로 동작하고 있다. 사용자 시안(A/B/C) 확정 후 승인된 디자인 토큰(`tokens.css`)과 다크 모드(`[data-theme="dark"]`)를 전체 화면에 체계적으로 반영해야 한다.
2. **실제 Gemini API 호출 미검증**: AI 면접 질문 생성 기능은 모의 스텁(Stub) 환경에서 HTTP 헤더(`x-goog-api-key`), 타임아웃, 예외 처리, 속도 제한을 검증했으나, 실제 상용 API 키를 연동한 실호출 환경의 응답 품질과 지연 시간은 아직 검증하지 못했다.
3. **모바일 뷰포트 최적화**: 6열 칸반 보드는 데스크톱(1440px) 환경에 맞춰 설계되어 모바일 뷰포트(390px)에서는 수평 스크롤이 불가피하다. 모바일 전용 탭형 단계 전환 또는 아코디언 뷰 도입이 필요하다.
4. **파일 첨부 지원 부재**: 이력서나 포트폴리오 PDF 파일을 데이터베이스나 로컬 스토리지에 업로드하는 기능이 아직 없으며, 텍스트 형태의 경험 자료함으로만 스펙을 관리하고 있다.

## 14. 참고 자료

* **경쟁 서비스 조사 및 레퍼런스**:
  * 해외 구직 트래커: Huntr (huntr.co), Teal (tealhq.com), Simplify (simplify.jobs)
  * 국내 채용 및 자소서 플랫폼: 자소설닷컴 (jasoseol.com), 잡코리아, 사람인, 링커리어, 캐치
  * 경쟁 서비스 기능 비교 및 요금제 분석 기록: `docs/RESEARCH_NOTES.md`
* **UI/UX 디자인 및 서체 레퍼런스**:
  * 디자인 레퍼런스 분석서: `docs/DESIGN_REFERENCES.md`
  * 디자인 시안 A/B/C 및 스크린샷 보고서: `design/mockups/README.md`
  * 서체: Pretendard Variable (고정폭 숫자 `tabular-nums` 적용)
* **공식 기술 문서 및 가이드**:
  * Node.js 22 내장 테스트 러너 공식 문서 (`node:test`)
  * Express 4.x 공식 가이드 및 Helmet 보안 권고
  * better-sqlite3 공식 저장소 (WiseLibs/better-sqlite3)
  * Chart.js 4.x 문서 및 로컬 번들링 가이드
  * Google Generative AI REST API 개발자 가이드
* **프로젝트 내부 설계 및 관리 문서**:
  * 기능 요구사항 명세서: `docs/SPEC.md`
  * 시스템 아키텍처 정의서: `docs/ARCHITECTURE.md`
  * 데이터베이스 설계서: `docs/DB_DESIGN.md`
  * 단계별 작업 목록 및 추적표: `docs/TASKS.md`
  * 프로젝트 계획서: `docs/PROJECT_PROPOSAL.md`
