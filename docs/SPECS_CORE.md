# 스펙 관리 코어 계약

기준: Notion `4167cdef-782d-813d-8c80-e5602d2838ad` 4–7절.
기존 Express/EJS/SQLite 구조와 `docs/DESIGN_SYSTEM.md`를 사용한다.
외부 소스 어댑터와 스펙 찾기 화면은 별도 모듈이다.

## 저장 및 소유권

- `schema.sql`은 `spec_items`, `spec_watch`, `external_cache`를 생성한다.
- 원본 중복 키는 `(user_id, source, source_ref)`이며 NULL 원본 ID는 중복을 허용한다.
- `events.spec_item_id`와 `todos.spec_item_id`는 자동 생성된 행의 연결 키다.
  신규 DB는 FK `ON DELETE CASCADE`를 사용한다. 기존 DB에는 migration이 nullable
  컬럼과 `(user_id, spec_item_id)` 인덱스를 추가한다. 두 DB 경로 모두 동일하게 동작하도록
  서비스 삭제 트랜잭션에서 연결 일정·할 일을 명시적으로 삭제한다.
- 개인 데이터 조회·변경에는 `user_id` 조건을 사용한다. 소유하지 않은 항목은 서비스에서
  `null`/`false`를 반환하고 HTTP 라우터가 404로 변환한다.
- `material_id`는 완료 자동화가 설정한다. 클라이언트 payload로 임의 자료를 연결하지 않는다.
- 캐시는 개인 데이터가 없는 공유 캐시이며 `fetched_at`은 epoch milliseconds다.
  TTL은 `readExternalCache` 호출자가 지정한다. 만료·손상·미존재는 `null`이다.

## 자동화

- 등록은 트랜잭션 안에서 먼저 기본 일정·접수 할 일을 만들고 선택된 상태를 적용한다.
  이미 접수한 상태로 등록해도 접수 이력이 연결되며 접수 할 일은 완료 처리된다.
- 접수 시작 09:00, 접수 마감 18:00, 시험·시작 09:00, 결과 발표 09:00.
  `end_date`는 타임라인과 자료 요약에만 포함하며 별도 일정을 만들지 않는다.
- 자동화 재실행은 기존 연결 행을 사용한다. 활성 항목 수정 시 일정·미완료 접수 할 일의
  제목과 날짜를 동기화한다. 수동 일정은 연결 키가 없으므로 건드리지 않는다.
- 완료·합격은 연결 자료가 없을 때만 경험 자료함 초안을 생성한다. 자료함에는 별도 draft
  상태 컬럼이 없으므로 내용 첫 줄에 초안임을 명시하고 STAR 보완을 안내한다.
- 자료 종류: 자격증 → `award`/자격증, 공모전 합격 → `award`/공모전·수상,
  공모전 완료 → `activity`/공모전, 부트캠프 → `project`/교육·부트캠프,
  대외활동 → `activity`/대외활동, 대학원 → `other`/대학원, 기타 → `other`/스펙.
- 중단은 오늘 이후(오늘 포함) 연결 일정과 미완료 할 일만 삭제한다. 과거 일정·완료 할 일은
  유지한다. 스펙 삭제는 모든 연결 일정·할 일을 지우지만 이미 생성한 경험 자료는 유지한다.

## 공개 서비스 함수

`src/services/specsService.js`의 함수 exports:

```js
createSpecItem(db, userId, payload)
getSpecItem(db, userId, id)
listSpecItems(db, userId, filters = {})
updateSpecItem(db, userId, id, payload = {})
updateSpecStatus(db, userId, id, status)
deleteSpecItem(db, userId, id)
addWatch(db, userId, input, certName)
createSpecWatch(db, userId, input)
removeWatch(db, userId, certCode)
listWatches(db, userId)
readExternalCache(db, source, queryHash, ttlMs)
writeExternalCache(db, source, queryHash, payload)
groupSpecBoard(items)
getSpecLinks(db, userId, item)
specTimeline(item, today = localDateString())
listUpcomingSpecDates(db, userId, { days = 14, limit = 5, now = new Date() } = {})
formatSpecDate(date)
sourceBadge(source)
validateSpecPayload(payload)
```

- `filters`: `{ kind, status, q, from, to }`. 기간은 어느 날짜 필드든 범위에 포함되면 일치한다.
- `updateSpecItem`: 부분 수정이며 없는 키는 기존 값을 유지한다.
- `createSpecItem`: 저장된 항목과 `duplicate`, `automation`을 반환한다. 원본 중복이면
  기존 항목에 `duplicate: true`를 붙이고 자동화는 재실행하지 않는다.
- `addWatch`: `input = { cert_code, cert_name }` 또는 `(code, name)` 인자를 지원하며
  `{ watch, duplicate }`를 반환한다. `createSpecWatch`는 어댑터 호환용 `{ duplicate }` 반환이다.
- 검증 오류는 `SpecValidationError` (`status: 422`, `code: SPEC_VALIDATION`)다.
- 상수 exports: `SPEC_KINDS`, `SPEC_SOURCES`, `SPEC_STATUSES`, `DATE_FIELDS`,
  `STATUS_LABELS`, `KIND_LABELS`, `SOURCE_LABELS`, `BOARD_COLUMNS`.

## 화면과 보안

- `/specs`는 5개 상태 컬럼 또는 목록을 표시한다. 종류·상태·검색·기간 필터를 지원하며
  보기 전환·종류 칩에서도 필터를 유지한다. 작은 화면의 보드는 내부 가로 스크롤을 사용한다.
  목록 표도 디자인 시스템의 모바일 표 규칙에 따라 내부 가로 스크롤을 유지한다.
  날짜·요일은 한 단위로 표시하고 상세 안내문은 한글 단어 중간의 음절 분리를 피한다.
- 상태 변경은 POST 폼과 PATCH JSON API를 모두 지원한다. 등록·수정·상태 검증 실패 시
  422로 폼을 다시 표시한다. 모든 변경 요청에는 기존 CSRF 미들웨어가 적용된다.
- `/specs/discover`는 파일 존재 시에만 core 라우터보다 먼저 마운트한다.
- 대시보드는 활성 스펙의 접수 시작·접수 마감·시험/시작 중 오늘부터 14일 이내 날짜를
  오름차순으로 최대 5개 표시한다. D-3 이하는 강조한다.
- EJS 사용자 값은 escaping을 사용한다. 인라인 스타일·스크립트 없이 기존 strict CSP를 유지한다.

## 검증 기록 (2026-11-12)

- `npm test`: 172 tests, 172 pass, 0 fail, 0 skipped.
- 변경 JavaScript의 `node --check`: 통과. 별도 build/typecheck 스크립트는 없는 JS/EJS 앱이다.
- `grep -rn 'style="' views/`: 0건.
- 선택적 discover 파일이 없는 상황에서도 메모리 DB로 앱 생성 성공.
- `/tmp/rsj-specs.db`에 기존 `seed(app.db)`를 실행하고 Playwright headless로
  1440×900, 390×844, 768×900, 375×900, 1280×900에서 6개 화면을 확인했다.
  `/specs`, `/specs/1`, `/specs/new`, `/dashboard`, `/specs?view=list`, `/specs/1/edit`.
  전부 HTTP 200, 문서 가로 넘침 0건, 콘솔·페이지 오류 0건.
- 브라우저에서 기간 필터·합격 후 자료함 연결·JavaScript 비활성 등록/상태 변경 통과.
- 독립 디자인·기능 검토 통과. CJK 검토에서 발견한 상세 안내문의 음절 분리와
  목록 날짜·요일 줄바꿈을 수정한 뒤 375/390/768px 재검토에서 PASS를 받았다.
- PNG: `/tmp/rsj-specs-evidence/{board,detail,new,dashboard,list,edit}-{1440,390,768,375,1280}.png`.
  추가 상태: `filtered-empty.png`, `passed-detail.png`, `board-dark.png`.
  기계 검증 결과: `/tmp/rsj-specs-evidence/results.json`.
- LSP 진단은 시도했으나 TypeScript/JavaScript 및 CSS Biome 서버 미설치(기존 설치 거절),
  EJS/Markdown 서버 미설정으로 실행 불가. LSP 오류 0건이라는 주장은 하지 않는다.
