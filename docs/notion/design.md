# ReadySetJob: UI/UX 디자인 및 레퍼런스

> 💡 **개요**: 본 문서는 글로벌 SaaS 및 문서 집필 도구(Linear, Huntr, Craft 등)의 UI/UX 패턴 분석, ReadySetJob의 6대 통합 디자인 원칙, 3가지 디자인 시안(A/B/C)의 비교 분석과 GitHub 스크린샷 링크, 그리고 사용자 승인 대기 현황을 정리한 하위 기술 문서이다.

---

## 1. UI/UX 레퍼런스 분석 및 채택과 배제 (Adopt & Avoid)

ReadySetJob은 파이프라인 관리(칸반), 장문 문서 작성 및 버전 비교(에디터), 데이터 시각화(대시보드)라는 3가지 성격을 동시에 지닌다. 이에 부합하는 6대 레퍼런스를 조사하여 채택할 점과 배제할 점을 명확히 정리했다.

### 1.1 Linear: 미니멀 SaaS 레이아웃과 시각적 절제
* **관찰 패턴**: 좌측 220px 저채도 오프화이트 사이드바와 상단 48px 단일 뷰 헤더가 메인 작업 캔버스를 감싸는 역 L자형 애플리케이션 크롬 구조. LCH 색공간 기반의 중립적 표면, 1px 저대비 테두리, 키보드 단축키 중심의 명령 메뉴(`Cmd+K`).
* **채택할 점 (Adopt)**:
  * 사이드바와 상단 뷰 헤더를 통한 깔끔한 작업 공간 구획.
  * 그림자 대신 `1px solid` 테두리와 미세한 명도 차이를 사용한 정갈한 정보 배치.
  * 검색창, 단계 및 결과 필터 칩, 정렬 옵션을 단일 행(높이 44px~48px)으로 압축한 헤더 바.
* **배제할 점 (Avoid)**:
  * 마우스 조작 버튼을 숨기고 단축키에만 과도하게 의존하는 인터랙션 (취업 준비생을 위해 주요 액션 버튼을 화면에 명시 노출).
  * 영문 전용 자간 음수값(`-0.02em` 이하)의 기계적 복제 (한글 글자 뭉침 방지).

### 1.2 Huntr: 채용 파이프라인 칸반 및 지원 카드 아키텍처
* **관찰 패턴**: 드래그앤드롭 기반 5단계 열 칸반 보드(`Wishlist` -> `Applied` -> `Interview` -> `Offer` -> `Rejected`). 열 헤더의 건수 배지, 지원 카드 타일과 상세 모달, 단계별 전환율을 보여주는 `Job Search Funnel`.
* **채택할 점 (Adopt)**:
  * 칸반 열 헤더 우측의 고정폭 숫자 건수 배지(`4`) 및 빠른 추가 인터랙션.
  * 칸반 카드 표면에 기업명, 직무명, 결과 배지, D-Day, 자소서 연결 태그 등 핵심 정보만 압축 배치.
  * 대시보드에서 전형 단계별 통과율과 전환 실적을 시각화하는 퍼널 차트.
* **배제할 점 (Avoid)**:
  * `Rejected(불합격)`를 단일 칸반 열로 분리하는 구조 (어느 단계에서 탈락했는지 맥락이 소실되므로 배제, 6단계 열 내부에서 결과 배지만 전환).
  * 카드 배경 전체에 강한 원색을 칠하는 방식 (시각적 피로도를 높이므로 캡슐 배지와 3px 좌측 액센트 바로 제한).

### 1.3 Craft: 문서 중심 에디터 타이포그래피와 보조 패널 분리
* **관찰 패턴**: 좌측 탐색 영역(목차 TOC), 중앙 종이 형태의 집중 집필 캔버스(최대 폭 720px~760px), 우측 스타일 및 버전 보조 패널의 3단 역할 분리.
* **채택할 점 (Adopt)**:
  * 자소서 에디터에서 좌측 문항 목차(TOC) + 중앙 종이형 캔버스 + 우측 경험 자료 및 버전 이력 패널 분리.
  * UI 텍스트(13px~14px)와 자소서 본문 텍스트(15px, 행간 1.7, `word-break: keep-all`)의 타이포그래피 이원화.
  * 각 자소서 문항을 독립된 카드로 감싸고 하단에 실시간 글자수/바이트 및 진행률 바 배치.
* **배제할 점 (Avoid)**:
  * 화려한 그라데이션, 배경 커버 이미지, 스티커 등 장식적 스타일 (가독성을 해치므로 완전 배제).

### 1.4 추가 레퍼런스 (Attio, Notion, Pretendard)
* **Attio**: 칸반 카드 클릭 시 화면 이동 없이 우측에서 열리는 440px 슬라이드오버 드로어(Slide-over Drawer) 패턴 채택.
* **Notion**: 상태 속성을 저채도 파스텔 배경과 고대비 텍스트의 캡슐형 뱃지(Pill Badge)로 시각화하는 패턴 채택.
* **Pretendard**: 한글, 영문, 숫자가 혼용되는 모든 화면에 Pretendard Variable 적용. 숫자 변동 시 레이아웃 흔들림을 막기 위해 `font-variant-numeric: tabular-nums` 강제 적용.

---

## 2. ReadySetJob 6대 통합 디자인 원칙

1. **단일 오프화이트 라이트 모드 (Clean Light Mode)**:
   * 장시간 자소서를 읽고 퇴고하기에 가장 편안한 오프화이트 톤(`#F8FAFC` 또는 `#F7F7F5`)을 배경으로 채택하고, 작업 카드와 에디터 캔버스는 순백색(`#FFFFFF`)으로 띄워 깊이를 표현한다.
2. **섬세한 1px 테두리와 절제된 그림자**:
   * 모든 카드와 패널은 `1px solid #E2E8F0`의 저대비 경계선으로 구획한다.
   * 기본 상태의 카드에는 그림자를 쓰지 않고, 호버 시에만 극도로 옅은 그림자(`0 4px 12px rgba(15, 23, 42, 0.06)`)를 적용한다.
3. **단일 액센트 컬러와 시맨틱 상태 색상**:
   * 전체 화면의 85% 이상을 무채색으로 유지하고, 주요 CTA 버튼과 활성 메뉴에만 단일 브랜드 액센트(`Indigo Slate #4F46E5` 또는 `Royal Blue #2563EB`)를 적용한다.
   * 전형 결과와 Diff 비교는 약속된 시맨틱 색상 쌍(합격/추가: `#ECFDF5`/`#047857`, 불합격/삭제: `#FEF2F2`/`#B91C1C`, D-Day 임박: `#FFFBEB`/`#B45309`)만 사용한다.
4. **Pretendard 기반 타이포그래피 위계 및 숫자 정렬**:
   * UI 요소는 13px~14px(행간 1.4)로 촘촘히 유지하고, 자소서 에디터와 Diff 본문은 15px(행간 1.7)로 넉넉한 호흡을 제공한다.
   * 통계 수치, D-Day, 글자수 카운터에는 `tabular-nums`를 강제한다.
5. **단계(6-Stage)와 결과(Result)의 시각적 분리**:
   * 칸반 보드의 가로 열은 전형 단계(`서류`, `코딩테스트`, `과제`, `1차 면접`, `2차 면접`, `최종`)만 나타내며, 탈락한 지원 건도 해당 단계 열 내부에서 `불합격` 배지로 전환되어 보존된다.
6. **불변 버전 비교와 실시간 글자수 피드백**:
   * 에디터에서 저장 시 불변 버전 스냅샷을 생성하고, 버전 비교 모드에서 단어 단위 Diff(`<ins>`, `<del>`)를 즉시 대조하며 과거 버전으로 안전하게 복원한다.

---

## 3. 디자인 시안 A / B / C 상세 비교

동일한 공통 데모 데이터(전체 18건, 진행중 11건, 최종합격 2건, 불합격 5건)를 기반으로 정보 배치와 작업 우선순위가 뚜렷이 구별되는 세 가지 정적 HTML 목업을 제작했다.

### 3.1 시안별 요약 비교표

| 비교 기준 | [A안] Linear 기반 미니멀 SaaS형 | [B안] Huntr 기반 채용 관리 중심형 | [C안] Craft 기반 문서 작업 중심형 |
|:---|:---|:---|:---|
| **전역 내비게이션** | 좌측 고정 사이드바(220px) + 상단 헤더 | 상단 수평 GNB(56px) + 퍼널 요약 바 | 좌측 접이식 탐색 바(200px) + 우측 패널 |
| **대시보드 강조점** | 4열 압축 KPI 카드 + 전형별 합불 막대 차트 | 6단계 전형 퍼널 배너 + 주간 일정 브리핑 | 작성 중인 자소서 카드 그리드 + 경험 통계 |
| **지원 칸반 레이아웃** | 84px 컴팩트 카드 + 440px 우측 슬라이드 드로어 | 전폭 100% 6열 보드 + 860px 중앙 탭 모달 | 자소서 버전 및 경험 태그가 달린 도시에 보드 |
| **자소서 에디터** | 2단 분할 (문항 카드 + 340px 독) | 3단 분할 (문항 탭 + 중앙 에디터 + 우측 패널) | 200px 목차 + 760px 순백색 종이 캔버스 & Diff |
| **타이포 및 밀도** | 본문 13px / 고밀도 (패딩 12px) | 본문 14px / 중간 밀도 (패딩 14~16px) | 본문 15px, 행간 1.75 / 여유로운 문서 밀도 |
| **브랜드 액센트** | 인디고 슬레이트 (`#4F46E5`) | 로열 블루 & 앰버 (`#2563EB`, `#D97706`) | 딥 틸 잉크 (`#0F766E`) |
| **장점** | 여백 낭비 없이 많은 공고를 빠르게 모니터링 | 1440px에서 6열이 한눈에 보이며 일정 파악 용이 | 자소서 글쓰기 몰입도와 단어 단위 Diff 가독성 우수 |
| **알려진 결함 및 한계** | 상세 드로어가 열릴 때 1440px에서 3열만 보임 | 상단 GNB와 퍼널 배너로 본문 세로 공간 다소 협소 | 에디터 본문 내용이 캔버스 밖으로 일부 넘치는 현상 |

> ⚠️ **알려진 시안 결함 안내**: 현재 제작된 목업에서 확인된 2가지 레이아웃 결함(A안 칸반 상세 드로어 오픈 시 1440px 기준 3개 열만 표시되는 가로 폭 협소 문제, C안 에디터 본문 텍스트가 캔버스 밖으로 넘치는 CSS 오버플로 문제)은 사용자 피드백 반영 및 최종 승인 후 정식 뷰 구현 단계에서 수정될 예정이다.

---

## 4. 시안별 스크린샷 갤러리 및 GitHub 링크 모음

각 화면은 실제 브라우저 환경에서 1440x900 데스크톱 및 390x844 모바일 뷰포트로 캡처된 12장의 고해상도 스크린샷이다.

### 4.1 A안 (Linear 기반 미니멀 SaaS형)
* **대시보드**: [a-dashboard.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/a-dashboard.png)
  * 상단 4열 압축 KPI와 전형별 차트, 최근 지원 테이블이 한 화면에 압축된 고밀도 레이아웃.
* **지원 현황 칸반**: [a-kanban.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/a-kanban.png)
  * 좌측 사이드바와 컴팩트 84px 카드 타일, 우측 슬라이드오버 드로어가 결합된 인터페이스.
* **자기소개서 에디터**: [a-editor.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/a-editor.png)
  * 좌측 65% 문항 카드와 우측 35% 고정 컨텍스트 패널로 구성된 2단 에디터.
* **모바일 칸반 (390x844)**: [a-kanban-mobile.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/a-kanban-mobile.png)

### 4.2 B안 (Huntr 기반 채용 관리 중심형)
* **대시보드**: [b-dashboard.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/b-dashboard.png)
  * 상단 6단계 전형 퍼널 배너와 주간 일정 브리핑이 전폭으로 펼쳐진 파이프라인 허브.
* **지원 현황 칸반**: [b-kanban.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/b-kanban.png)
  * 좌측 사이드바 없이 1440px 화면 전체를 6열 칸반으로 활용하는 전폭 시원한 보드.
* **자기소개서 에디터**: [b-editor.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/b-editor.png)
  * 상단 지원 공고 정보 고정 헤더와 좌측 문항 탭이 연동된 3단 에디터.
* **모바일 칸반 (390x844)**: [b-kanban-mobile.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/b-kanban-mobile.png)

### 4.3 C안 (Craft 기반 문서 작업 중심형)
* **대시보드**: [c-dashboard.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/c-dashboard.png)
  * 작성 중인 자소서 문서 카드 그리드와 경험 소재 활용 통계 중심 대시보드.
* **지원 현황 칸반**: [c-kanban.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/c-kanban.png)
  * 지원 카드에 연결된 자소서 버전과 경험 태그를 직접 표시하는 패키지형 보드.
* **자기소개서 에디터**: [c-editor.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/c-editor.png)
  * 200px 문항 목차(TOC), 760px 순백색 종이 캔버스, 어절 단위 단어 비교(Diff)가 결합된 스튜디오.
* **모바일 칸반 (390x844)**: [c-kanban-mobile.png](https://github.com/NoNamad5196/ReadySetJob/blob/main/design/mockups/screenshots/c-kanban-mobile.png)

---

## 5. 디자인 승인 상태 및 사후 결정 사항 체크리스트

### 5.1 현재 승인 상태
* **상태**: `사용자 승인 대기 (Pending User Review)`
* **판정 기준**: 3가지 시안의 정적 HTML 및 스크린샷 12장 제작이 완료되었으며, 사용자가 최종 선호안 또는 하이브리드 조합을 선택하기 전까지 코드베이스의 디자인 시스템 확정을 보류한다.

### 5.2 추천 하이브리드 구현 방향
* **전체 앱 크롬 및 지원 칸반**: **B안**의 상단 GNB 및 전폭 6단계 칸반 보드를 기본 구조로 채택하여 1440px 화면에서 모든 전형 단계가 가로 스크롤 없이 한눈에 들어오도록 구성.
* **자기소개서 에디터 및 버전 비교**: **C안**의 760px 순백색 종이 캔버스, 어절 단위 Diff 뷰, 좌측 문항 목차(TOC) 신호등을 채택하여 작성 몰입도 극대화.
* **카드 상세 조작 인터랙션**: **A안**의 우측 슬라이드오버 드로어를 접목하여 칸반 보드 위에서 화면 전환 없이 공고 상세와 메모를 조회.

### 5.3 승인 후 결정 사항 체크리스트
- [ ] 사용자 디자인 시안 최종 선택 (A안, B안, C안 또는 B+C+A 하이브리드안) 확정
- [ ] `docs/DESIGN_SYSTEM.md` 최종 작성 및 컴포넌트 명세 확정
- [ ] `public/css/tokens.css`의 CSS 변수 토큰 및 `public/css/app.css` 전역 스타일 최종 동기화
- [ ] A안 칸반 가로 폭 협소 및 C안 에디터 본문 넘침 CSS 결함 수정
- [ ] EJS 공통 레이아웃(`views/layouts/main.ejs`) 및 개별 뷰 화면에 승인된 컴포넌트 스타일 전면 반영
- [ ] 데스크톱(1440px) 및 모바일(390px) 반응형 뷰포트 최종 시각적 검증 통과
