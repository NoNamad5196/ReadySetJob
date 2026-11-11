# ReadySetJob (레디셋잡)

> **취업 및 인턴십 지원 현황 추적과 불변 자기소개서 버전 관리 웹 애플리케이션**  
> 2026학년도 2학기 고급웹프로그래밍 기말 프로젝트 (1인 개발)

---

## 1. 프로젝트 소개

**ReadySetJob**은 개발자 취업 및 인턴십을 준비하는 구직자가 겪는 일정 관리의 어려움과 자기소개서 버전 혼선을 해결하기 위해 개발된 웹 애플리케이션입니다.

공고 마감일 D-Day 관리, 6단계 전형 파이프라인 칸반 보드, Git 커밋 개념을 도입한 불변 버전 자기소개서 에디터, 단어 단위 텍스트 비교(Diff), 전형 단계별 통계 시각화 및 직무 맞춤형 AI 면접 질문 생성을 하나의 시스템에서 통합 제공합니다. 복잡한 외부 상주 서비스 없이 Node.js와 SQLite 단일 파일 데이터베이스로 구동되어 빠른 속도와 온전한 데이터 소유권을 보장합니다.

---

## 2. 주요 기능

* **인증 및 보안**:
  * bcryptjs 단방향 해싱 기반의 안전한 계정 생성 및 로그인
  * 세션 고정 공격을 방지하는 로그인 시 세션 재생성(`req.session.regenerate`)
  * `crypto.timingSafeEqual` 기반 상수 시간 CSRF 토큰 검증 (HTML 폼 및 비동기 API)
  * 모든 데이터베이스 쿼리에 `user_id`를 바인딩하여 타인 데이터 접근 차단 (404 처리)
* **기업 및 채용 공고 관리**:
  * 기업 등록 및 메모, 사용자별 기업명 중복 방지(`UNIQUE(user_id, name)`)
  * 채용 공고 등록 시 신규 기업 인라인 동시 생성 트랜잭션 지원
  * 공고 마감일 실시간 D-Day 계산 배지 및 관심 공고 북마크 토글
* **지원 현황 및 6단계 칸반 보드**:
  * 서류, 코딩테스트, 과제, 1차 면접, 2차 면접, 최종 등 6단계 전형 파이프라인
  * HTML5 드래그 앤 드롭 및 키보드 조작을 통한 단계 이동 및 컬럼 내 순서 재정렬
  * 자바스크립트가 비활성화된 브라우저 환경을 지원하는 no-JS 폼 이동 폴백
  * 전형 단계 및 결과 변경 이력을 영구 보존하는 감사 로그(`stage_logs`) 자동 누적
* **전형 일정 관리**:
  * 지원 건과 연동된 서류 마감, 시험, 면접 일정을 시간순으로 정렬하여 캘린더형 목록 제공
* **자기소개서 불변 버전 관리 시스템**:
  * 공고별 다중 문항 작성기 (문항 추가, 삭제, 순서 변경, 공백 포함/제외 글자수 카운터)
  * 버전 증가 없는 자동 초안 저장(Ctrl+S) 지원
  * 스냅샷 기반의 불변 버전 생성 (`MAX(version_no) + 1`, 수정 및 삭제 불가)
  * 서버 사이드 `jsdiff` 기반 단어 단위 비교 화면 (`<ins>`, `<del>` 시각화 및 XSS 방어)
  * 이전 버전 복원 시 현재 초안 자동 백업 및 복원 출처(`restored_from_version_id`) 기록
  * 작성 중인 에디터에서 과거 자기소개서 문항 검색 및 경험 자료 즉시 연동
* **대시보드 통계 및 데이터 시각화**:
  * 상단 핵심 지표 요약 (총 지원, 서류 통과율, 최종 합격 건수, 관심 공고)
  * 단계별 전환율 막대 차트, 합격/불합격 도넛 차트, 월별 지원 추이 선 그래프
  * Chart.js npm 패키지를 `/vendor/chart.js`로 자체 서빙하여 외부 CDN 의존 차단
  * D-7 마감 임박 공고 및 다가오는 일정 요약 위젯
* **경험 자료함**:
  * 프로젝트, 수상, 인턴, 대외활동 등 본인의 스펙을 카테고리 및 태그별로 정리
* **AI 취업 도우미 (OpenAI Responses API)**:
  * 지원 공고(기업명, 직무, 메모)와 자기소개서 답변을 기반으로 OpenAI Responses API 맞춤 면접 질문 도출, 자기소개서 문항 피드백, 경험 자료 STAR 초안 생성, 채용 공고 텍스트 자동 추출 지원
  * API 키(`OPENAI_API_KEY`) 미설정 시 버튼이 비활성화되며 가짜 응답 없이 정직하게 안내
  * 사용자별 10분당 최대 20회 생성 속도 제한 적용

---

## 3. 스크린샷 및 디자인 시안

ReadySetJob은 사용자 경험 설계를 위해 3가지 콘셉트의 정적 HTML 디자인 시안과 스크린샷을 제작했습니다.

* **디자인 시안 비교 보고서**: [`design/mockups/README.md`](design/mockups/README.md)
* **목업 갤러리 인덱스**: [`design/mockups/index.html`](design/mockups/index.html)
* **시안 A (Linear 미니멀 SaaS형)**: 고밀도 워크스페이스 및 슬라이드오버 드로어 ([`design/mockups/a/`](design/mockups/a/))
* **시안 B (Huntr 채용 파이프라인 중심형)**: 전폭 6열 칸반 및 일정 브리핑 허브 ([`design/mockups/b/`](design/mockups/b/))
* **시안 C (Craft 문서 작업 중심형)**: 자기소개서 집중 에디터 및 분할 뷰 ([`design/mockups/c/`](design/mockups/c/))
* **스크린샷 갤러리**: [`design/mockups/screenshots/`](design/mockups/screenshots/) (데스크톱 9장, 모바일 3장)

> **안내**: 현재 애플리케이션의 화면은 비즈니스 로직과 데이터 정합성을 검증하기 위한 중립 스타일(Scaffold)로 구현되어 있습니다. 디자인 시안은 검토 중이며, 사용자 최종 승인 후 Phase P3에서 정식 디자인 시스템(`docs/DESIGN_SYSTEM.md`)으로 전면 교체될 예정입니다.

---

## 4. 기술 스택

* **런타임**: Node.js v22.14.0 LTS
* **웹 프레임워크**: Express 4.21.2
* **뷰 템플릿**: EJS 3.1.10
* **데이터베이스**: SQLite 3 (`better-sqlite3` 11.5.0, WAL 모드, foreign_keys ON)
* **세션 관리**: `express-session` + `better-sqlite3-session-store` 0.1.0
* **보안**: `bcryptjs` 3.0.2, `helmet` 8.0.0 (CSP 설정 포함)
* **텍스트 비교**: `diff` (jsdiff 7.0.0)
* **차트 라이브러리**: Chart.js 4.4.6 (로컬 정적 서빙)
* **인공지능**: OpenAI Responses API (`gpt-6.1-terra`, `gpt-6-luna`, Structured Outputs)
* **테스트**: Node.js 내장 테스트 러너 (`node --test`), `supertest` 7.0.0

---

## 5. 실행 방법

### 5.1 사전 준비
* Node.js 22.x LTS 이상 설치 권장

### 5.2 단계별 설치 및 실행

1. **저장소 복제 및 의존성 설치**
   ```bash
   npm install
   ```

2. **환경 변수 파일 생성**
   ```bash
   cp .env.example .env
   ```

3. **데이터베이스 마이그레이션 및 데모 데이터 시드**
   ```bash
   npm run seed
   ```
   * 한국 IT 기업(네이버, 카카오, 토스 등)의 실제 공고, 지원 내역, 전형 일정, 자기소개서 샘플 데이터가 자동 생성됩니다.
   * **기본 데모 계정**: `demo@readysetjob.dev` / 비밀번호: `demo1234!`

4. **웹 서버 시작**
   ```bash
   npm start
   # 개발 모드 (파일 수정 시 자동 재시작):
   npm run dev
   ```
   * 브라우저에서 `http://localhost:3000`으로 접속합니다.

5. **자동화 테스트 실행**
   ```bash
   npm test
   ```
    * Node.js 22 내장 테스트 러너를 통해 15개 스위트, 66개 테스트 케이스를 순차 실행합니다.

---

## 6. 환경 변수 설정

`.env.example` 파일을 복사하여 `.env`를 구성합니다. 모든 환경 변수의 용도와 기본값은 아래와 같습니다.

| 변수명 | 필수 여부 | 기본값 | 설명 |
|:---|:---:|:---|:---|
| `PORT` | 선택 | `3000` | HTTP 웹 서버 수신 포트 번호 |
| `SESSION_SECRET` | 프로덕션 필수 | 개발용 폴백 문자열 | 세션 쿠키 암호화 서명 키. `NODE_ENV=production` 환경에서는 설정하지 않을 시 서버 시작이 즉시 차단됩니다. |
| `DB_PATH` | 선택 | `data/readysetjob.db` | SQLite 데이터베이스 파일 저장 경로 |
| `OPENAI_API_KEY` | 선택 | `(빈 값)` | OpenAI API 인증 키. 미설정 시 모든 AI 기능이 안전하게 비활성화되며 가짜 응답을 반환하지 않습니다. |
| `OPENAI_MODEL` | 선택 | `(빈 값)` | 설정 시 모든 AI 기능의 모델을 일괄 오버라이드합니다. |
| `OPENAI_MODEL_INTERVIEW` | 선택 | `gpt-6.1-terra` | 면접 예상 질문 생성에 사용할 OpenAI 모델 식별자 |
| `OPENAI_MODEL_FEEDBACK` | 선택 | `gpt-6.1-terra` | 자기소개서 문항 피드백에 사용할 OpenAI 모델 식별자 |
| `OPENAI_MODEL_DRAFT` | 선택 | `gpt-6.1-terra` | 경험 자료 STAR 초안 생성에 사용할 OpenAI 모델 식별자 |
| `OPENAI_MODEL_EXTRACT` | 선택 | `gpt-6-luna` | 채용 공고 텍스트 추출에 사용할 OpenAI 모델 식별자 |

---

## 7. 프로젝트 구조

```text
ReadySetJob/
├── src/
│   ├── app.js               # Express 애플리케이션 팩토리 (createApp, 세션, CSP, 미들웨어)
│   ├── server.js            # 서버 진입점 (HTTP listen)
│   ├── db/                  # 데이터베이스 계층 (connection, schema.sql, migrate, seed)
│   ├── middleware/          # 공통 미들웨어 (auth, csrf, validation, error)
│   ├── routes/              # 기능별 라우터 (auth, companies, jobs, applications, events, essays, materials, dashboard, ai)
│   └── services/            # 비즈니스 로직 및 better-sqlite3 트랜잭션 쿼리 서비스
├── views/                   # EJS 뷰 템플릿
│   ├── layouts/             # 기본 레이아웃 (main.ejs)
│   ├── partials/            # 공통 내비게이션 및 헤더/푸터
│   ├── auth/                # 로그인, 회원가입 뷰
│   ├── dashboard/           # 대시보드 통계 뷰
│   ├── companies/           # 기업 관리 뷰
│   ├── jobs/                # 채용 공고 관리 뷰
│   ├── applications/        # 지원 현황 및 6단계 칸반 보드 뷰
│   ├── events/              # 전형 일정 뷰
│   ├── essays/              # 자소서 에디터, 버전 목록, diff 비교 뷰
│   └── materials/           # 경험 자료함 뷰
├── public/                  # 정적 리소스 (css, js, img)
│   ├── css/                 # tokens.css, app.css, board.css, essay.css
│   └── js/                  # app.js, kanban.js, essay-editor.js
├── design/
│   └── mockups/             # 정적 HTML 디자인 시안 A/B/C 및 스크린샷 12장
├── docs/                    # 체계적 프로젝트 기술 문서
│   ├── FINAL_REPORT.md      # 기말 최종 프로젝트 보고서
│   ├── PROJECT_PROPOSAL.md  # 프로젝트 계획서 (2026-11-16 제출용)
│   ├── SPEC.md              # 기능 요구사항 명세서
│   ├── ARCHITECTURE.md      # 시스템 아키텍처 및 라우터 정의서
│   ├── DB_DESIGN.md         # 데이터베이스 설계서 (ERD 및 DDL)
│   ├── TASKS.md             # 단계별 작업 목록 및 진행 상태 추적표
│   ├── RESEARCH_NOTES.md    # 국내외 9개 경쟁 서비스 비교 분석서
│   ├── DESIGN_REFERENCES.md # UI/UX 레퍼런스 분석서
│   ├── IDEA_LOG.md          # 개발 일지 및 아이디어 로그
│   └── notion/              # 원격 Notion 동기화 백업 마크다운 문서들
└── test/                    # 통합 테스트 스위트 (15개 스위트, 66개 테스트)
```

---

## 8. 관련 문서 목록

프로젝트의 상세 설계와 개발 과정은 `docs/` 디렉터리의 기술 문서를 통해 투명하게 공개되어 있습니다.

* **최종 보고서**: [`docs/FINAL_REPORT.md`](docs/FINAL_REPORT.md) (프로젝트 개요, 구조, 핵심 코드, 문제 해결 과정, 테스트 결과 집계)
* **프로젝트 계획서**: [`docs/PROJECT_PROPOSAL.md`](docs/PROJECT_PROPOSAL.md) (개발 배경, 목표, 상세 기능 요구사항)
* **기능 요구사항 명세서**: [`docs/SPEC.md`](docs/SPEC.md) (입출력 명세, 에러 코드 및 유효성 검사 규칙)
* **시스템 아키텍처 정의서**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (계층별 책임 및 전체 HTTP 라우트 명세)
* **데이터베이스 설계서**: [`docs/DB_DESIGN.md`](docs/DB_DESIGN.md) (12개 테이블 ERD, 외래키 캐스케이드 정책, 인덱스)
* **작업 목록 및 상태 관리**: [`docs/TASKS.md`](docs/TASKS.md) (P0부터 P4까지의 완료 기준 및 실시간 진척도)
* **경쟁사 조사 일지**: [`docs/RESEARCH_NOTES.md`](docs/RESEARCH_NOTES.md) (Huntr, Teal, 자소설닷컴 등 9개 서비스 요금제/기능 비교)
* **UI/UX 레퍼런스 분석**: [`docs/DESIGN_REFERENCES.md`](docs/DESIGN_REFERENCES.md) (Linear, Craft, Huntr 디자인 토큰 분석)
* **개발 일지 및 로컬 백업**: [`docs/IDEA_LOG.md`](docs/IDEA_LOG.md) 및 [`docs/notion/`](docs/notion/)

---

## 9. 과제 및 라이선스 정보

* **과목명**: 2026학년도 2학기 고급웹프로그래밍
* **구분**: 기말 프로젝트 (1인 개발)
* **개발 기간**: 2026년 11월 ~ 2026년 12월
* **라이선스**: ISC License

