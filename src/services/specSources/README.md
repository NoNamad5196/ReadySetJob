# 스펙 찾기 데이터 소스

모든 네트워크 검증은 스텁으로만 수행했다. 실제 API 활용신청·실응답 검증은 하지 않았으며 아래 계약은 **확인 필요** 상태를 포함한다. 키 값은 화면·로그·오류·캐시 키에 저장하지 않는다.

## 어댑터와 활성 조건

| 어댑터 | 활성 조건 | 계약 / 확인 필요 |
| --- | --- | --- |
| `qnet.js` | `DATA_GO_KR_SERVICE_KEY` | Base `https://apis.data.go.kr/B490007/qualExamSchd`, 상수 `OPERATION_PATH=/getQualExamSchdList` **확인 필요**. 필기·실기 접수/시험/발표 날짜 필드와 `response.body.items.item`을 계약 스텁으로 검사 |
| `qnetCatalog.js` | 동적 목록은 같은 키 필요. 키·조회 실패 시 정보처리기사(1320)만 기본 표시 | `http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC/getList`, XML `jmcd`, `jmfldnm`, `qualgbcd`, `seriesnm`. 24시간 캐시. 실제 반환 계약·페이지 크기·HTTP/HTTPS 지원 **확인 필요**. 미확인 종목 코드는 정적 목록에 넣지 않음 |
| `dataq.js` | 같은 키 + `DATAQ_API_URL` | 활용신청 후 제공되는 전체 Swagger URL 필요. `https://api.odcloud.kr/api/15062838/...`만 허용. 한국어 시험명·회차·시험일·접수일·발표일 컬럼 **실응답 확인 필요** |
| `alio.js` | 같은 공공데이터포털 키 | Base `https://apis.data.go.kr/1051000/recruitment`, 상수 `LIST_PATH=/list` **확인 필요**. `recrutPbancTtl`, `instNm`, `pbancBgngYmd`, `pbancEndYmd`, `srcUrl` 등 방어적 후보 필드 **확인 필요**. `category: job` 결과는 기존 `POST /jobs` 폼으로 등록 |
| `work24.js` | `WORK24_AUTH_KEY` | `callOpenApiSvcInfo310L01.do`. `srchList` 배열 또는 `srchList.scn_list`를 지원. 실제 JSON 래퍼·기관명·분류 코드 C0105/C0061 의미·`sortCol` 값 **확인 필요**. 목록에 모집 마감일이 없어 `apply_end=null` |
| `aiVerified.js` | `OPENAI_API_KEY` | Responses API + `web_search` + strict JSON schema, 기존 검색 모델 설정과 사용자별 10분 20회 한도 공유. `aiService.js`/`aiSchemas.js` 수정 없음 |

`search(params, { db, fetchImpl })`로 fetch를 주입할 수 있고 각 어댑터는 `setFetchImpl()`도 제공한다. AI는 `aiFetchImpl`, `verifyFetchImpl`, `dnsLookupImpl`을 별도로 주입할 수 있다. 공통 요청 제한은 8초·1MiB이며, 캐시 TTL은 12시간(자격증 목록 24시간)이다. 인증키는 URLSearchParams에 **Decoding 값**을 넣는다. AI 검색 후보는 캐시 적중 시에도 페이지를 다시 검증하며 검증 실패 수를 응답의 `dropped`로 알린다.

## 자동 검증 허용 목록

- 대학원: `*.ac.kr`
- 민간자격: `exam.toeic.co.kr`, `opic.or.kr`, `dataq.or.kr` 및 해당 호스트 하위 도메인
- 공모전·대외활동·교육 대체 경로: `*.go.kr`, `*.or.kr`, `*.ac.kr`, `*.re.kr`, `*.mil.kr`
- 기업 `.com`/`.co.kr` 도메인을 넓게 허용하지 않는다. 안전성을 우선해 검증하지 못한 결과를 숨긴다.
- `logoService.AGGREGATOR_DOMAINS`에 더해 `wevity.com`, `thinkcontest.com`, `allcon.or.kr`, `all-con.co.kr`, `detizen.com`, `campuspick.com`, `contestkorea.com`은 제외한다.

서버는 A/AAAA DNS 결과 전체를 검사하고 사설·루프백·링크 로컬·CGNAT·예약·메타데이터 대역을 차단한다. 기본 HTTP transport는 검사된 DNS 결과로만 소켓을 연결해 재조회 시 DNS 리바인딩도 막는다. URL은 http/https만 허용하며 자격정보·명시적 포트는 금지한다. 각 리다이렉트에서 다시 검사하고 최대 2회, 전체 검증 시간 5초, 1MiB, text/html 또는 text/plain만 허용한다. 스크립트·스타일을 제외한 텍스트에서 제목 핵심어와 접수 마감일(없으면 시험·시작일)이 모두 일치해야 한다.

## 라우터 통합

`createSpecDiscoverRouter(db, dependencies?)`는 `/specs`에 코어 라우터보다 먼저 마운트한다. 반환 Express 하위 앱은 mount 이벤트에서 부모에 `/api/specs` 검색 API를 먼저 추가한다. 따라서 `src/app.js`를 변경하지 않아도 `POST /api/specs/discover`에 도달한다. 별도 구성에는 `createSpecDiscoverApiRouter(db, dependencies?)`도 쓸 수 있다.

등록은 세션에 저장된 검색 결과의 무작위 토큰만 받는다. 브라우저가 보낸 제목·날짜·출처·verified 값은 신뢰하지 않는다. 다른 사용자 토큰과 새 검색으로 만료된 토큰은 422로 거절한다. 자격증 구독은 공식 카탈로그 코드로 다시 확인하고 코어 `addWatch`를 호출한다.
