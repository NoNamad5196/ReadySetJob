# ReadySetJob — Agent Rules

취업·인턴 지원 현황과 자기소개서 버전을 관리하는 웹 앱 (고급웹프로그래밍 기말 프로젝트, 1인 개발).

## Deadlines
- 2026-11-16: 프로젝트 계획서 (`docs/PROJECT_PROPOSAL.md`) — 최우선
- 2026-12-16: 최종 발표 + 보고서 (`docs/FINAL_REPORT.md`)

## Stack (변경 금지 — 승인 없이 React/Next/Nest/Supabase 전환 금지)
- Node.js 22 + Express 4, EJS 템플릿, Vanilla JS, HTML/CSS
- SQLite via `better-sqlite3` (동기 API, 트랜잭션은 `db.transaction`)
- `express-session` + SQLite 세션 저장소, `bcryptjs` 해싱
- Chart.js (npm 설치 후 `/vendor` 정적 서빙, CDN 의존 금지)
- 테스트: `node --test` + `supertest`
- 무거운 의존성·상주 프로세스 금지 (헤드리스 Instabox 서버, 자원 제한)

## Layout
```
src/
  app.js            # express app factory (테스트에서 import)
  server.js         # listen
  db/               # connection, schema.sql, migrate, seed
  middleware/       # auth, csrf, validation, error
  routes/           # 기능별 라우터 (auth, companies, jobs, applications, essays, materials, dashboard, ai)
  services/         # DB 접근 로직 (라우터는 얇게)
views/              # EJS (layouts/partials/pages)
public/             # css/ js/ img/
design/mockups/     # 디자인 시안 A/B/C (정적 HTML) + screenshots/
docs/               # 문서 (아래 책임 표 참고)
test/
```

## Coding rules
- 모든 사용자 데이터 쿼리는 반드시 `user_id = ?` 로 소유권 검증. 타 사용자 리소스 접근 시 404.
- SQL은 항상 prepared statement. 문자열 연결로 SQL 만들지 않는다.
- 입력 검증은 라우터 진입부에서. 실패 시 폼 재렌더 + 오류 메시지(422).
- 상태변경 요청은 POST/PUT/PATCH/DELETE + CSRF 토큰. GET은 부수효과 없음.
- 자기소개서 버전(`essay_versions`)은 불변(immutable). 수정/복원은 항상 새 버전 생성.
- 전형 단계(stage)와 결과(result)는 별도 컬럼.
- 스타일은 `public/css/tokens.css`의 CSS 변수만 사용. 하드코딩 색상 금지. 라이트 기본, `[data-theme="dark"]` 대응.
- 디자인 최종안은 사용자 승인 전 확정 금지 (`docs/DESIGN_SYSTEM.md`가 승인 후 기준).
- 비밀값은 `.env`(커밋 금지). `.env.example`만 커밋.
- AI 키가 없으면 AI 기능은 비활성 상태로 명확히 표시. 가짜 응답 금지.

## Docs 책임
| 파일 | 책임 |
|---|---|
| README.md | 설치·실행·시연 방법 |
| docs/PROJECT_PROPOSAL.md | 11/16 제출 계획서 |
| docs/SPEC.md | 기능 요구사항 |
| docs/ARCHITECTURE.md | 시스템 구조, 라우터 명세 |
| docs/DB_DESIGN.md | ERD, 테이블, 제약 |
| docs/RESEARCH_NOTES.md | 외부 조사 결과(날짜·URL) 누적 |
| docs/DESIGN_REFERENCES.md | UI 레퍼런스 분석 |
| docs/DESIGN_SYSTEM.md | 승인된 디자인 토큰·컴포넌트 규칙 |
| docs/TASKS.md | 단계별 작업·완료 기준·상태 |
| docs/IDEA_LOG.md | Notion 일지 백업/개발 일지 |
| docs/FINAL_REPORT.md | 최종 보고서 |

## Status honesty
계획 / 개발 중 / 구현 완료 / 검증 완료 를 구분. 실행해 보지 않은 것은 "미검증".

## Git
- `main` 브랜치, 기능 단위 커밋 (Conventional Commits: feat/fix/docs/test/chore/style).
- force push, 이력 재작성 금지. 커밋·push는 지휘 에이전트가 수행 (서브에이전트는 커밋 금지).
