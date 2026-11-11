# ReadySetJob 디자인 시스템 (ReadySetJob Design System)

> **출처 및 승인 일자**: Figma 대시보드 시안 승인 (2026-11-11)  
> **적용 범위**: ReadySetJob 웹 애플리케이션 전체 (앱 셸, 공통 컴포넌트, 뷰 스타일링)  
> **준수 규격**: CSP `self-only` (인라인 스타일/스크립트/이벤트 핸들러 금지, CSS 변수 기반), 라이트 모드 기본 및 `[data-theme="dark"]` 다크 테마 지원

---

## 1. 디자인 원칙 (Core Principles)

1. **정보 중심과 신뢰성 (Data-First & Trustworthy)**
   - 취업 준비생의 중요한 지원 현황, 마감 기한, 전형 결과를 다루므로 시각적 과장이나 장식을 배제하고 데이터의 가독성과 명확성을 최우선으로 합니다.
2. **절제된 액센트 사용 (Restrained Accent)**
   - 화면 전체를 파란색으로 채우는 "Everything Light-Blue" 패턴을 금지합니다.
   - 메인 액센트(`#3182F6`)는 주요 행동 버튼(Primary Button), 활성 탭 인디케이터(Active Nav Bar), 포커스 링, 링크, 그리고 가장 중요한 단일 지표 숫자(The Single Key Metric)에만 엄격하게 제한하여 사용합니다.
3. **기능적 타이포그래피 (Functional Typography)**
   - Pretendard Variable을 채택하여 한글과 영문 숫자 간의 완벽한 조화를 유지합니다.
   - 제목 요소에는 미세한 음수 자간(`-0.01em ~ -0.02em`)을 적용하고, 날짜·시간·수치에는 `tabular-nums`를 적용하여 숫자가 줄바꿈되거나 틀어지지 않도록 정렬합니다.
4. **일관된 4px 공간 리듬 (4px Spacing Rhythm)**
   - 모든 여백(padding, margin, gap)은 4px 배수 스케일을 엄격히 준수합니다.
5. **명확한 상태 피드백 (Clear Semantic Feedback)**
   - 성공(녹색), 위험/임박(적색), 경고(주황)는 넓은 영역 배경색이 아닌 텍스트, 작은 상태 점(Dot), 절제된 소프트 배지 형태로 전달합니다.

---

## 2. 디자인 토큰 (Design Tokens)

### 2.1 색상 토큰 (Color Palette)

| 토큰명 | 라이트 모드 (Light) | 다크 모드 (Dark) | 용도 및 설명 |
|---|---|---|---|
| `--color-bg` | `#F7F8FA` | `#0E1117` | 전체 캔버스 배경 (Soft Cool Neutral) |
| `--color-surface` | `#FFFFFF` | `#161B22` | 기본 카드 및 사이드바/상단바 서피스 |
| `--color-surface-subtle` | `#F2F4F6` | `#21262D` | 입력창 배경, 보조 컨테이너, 테이블 헤더 |
| `--color-surface-hover` | `#E8ECF2` | `#30363D` | 리스트/아이템 마우스 호버 배경 |
| `--color-surface-selected`| `#EFF3F8` | `#282E37` | 선택된 항목/네비게이션 배경 |
| `--color-border` | `#E4E9EF` | `#30363D` | 기본 테두리 및 구분선 (1px solid) |
| `--color-border-subtle` | `#EDF1F5` | `#21262D` | 매우 부드러운 내부 경계선 |
| `--color-border-strong` | `#D3D9E1` | `#484F58` | 입력창 및 포커스 가능 컨트롤 테두리 |
| `--color-text` | `#191F28` | `#F0F6FC` | 본문 기본 텍스트 (고대비) |
| `--color-text-secondary` | `#4E5968` | `#C9D1D9` | 보조 텍스트, 라벨, 설명문 |
| `--color-text-muted` | `#697889` | `#8B949E` | 비활성 안내, 메타데이터, 부제목 |
| `--color-text-subtle` | `#8B95A1` | `#6E7681` | 플레이스홀더, 비활성 힌트 |
| `--color-text-inverse` | `#FFFFFF` | `#FFFFFF` | 반전 텍스트 (버튼 등) |
| `--color-primary` | `#3182F6` | `#3182F6` | 브랜드 메인 액센트 (블루) |
| `--color-primary-hover` | `#1B64DA` | `#4C94F8` | 액센트 버튼 호버 |
| `--color-primary-soft` | `#EDF4FF` | `#172A45` | 액센트 틴트 배경 |
| `--color-primary-text` | `#1B64DA` | `#70B1FF` | 액센트 강조 텍스트 |
| `--color-success` | `#0CA678` | `#2EA043` | 성공, 합격, 완료 지표 |
| `--color-success-soft` | `#E6FCF5` | `#143823` | 성공 배지 배경 |
| `--color-success-text` | `#099268` | `#3FB950` | 성공 텍스트 |
| `--color-danger` | `#F03E3E` | `#F85149` | 마감 임박(D-2), 탈락, 위험 |
| `--color-danger-soft` | `#FFF5F5` | `#381E20` | 위험 배지 배경 |
| `--color-danger-text` | `#C92A2A` | `#FF7B72` | 위험 텍스트 |
| `--color-warning` | `#F59F00` | `#D29922` | 일정 임박(D-4), 대기, 검토 |
| `--color-warning-soft` | `#FFF9DB` | `#342A14` | 경고 배지 배경 |
| `--color-warning-text` | `#D9480F` | `#E3B341` | 경고 텍스트 |

### 2.2 전형 6단계 인디케이터 컬러 (Stage Progress Indicator)

전형 상태 진행을 시각화하는 6단계 인디케이터 점(Dot) 컬러입니다.

| 단계 | 명칭 | 라이트 핀 점 색상 | 소프트 배경 (배지용) | 텍스트 색상 |
|---|---|---|---|---|
| Stage 1 | 서류 (Document) | `#697889` (회색 점) | `#EFF2F5` | `#4E5968` |
| Stage 2 | 코딩 테스트 (Coding Test) | `#3182F6` (파란색 점) | `#EDF4FF` | `#1B64DA` |
| Stage 3 | 과제 (Assignment) | `#7950F2` (보라색 점) | `#F3E8FF` | `#6741D9` |
| Stage 4 | 1차 면접 (1st Interview) | `#F59F00` (주황색 점) | `#FFF9DB` | `#D9480F` |
| Stage 5 | 2차 면접 (2nd Interview) | `#D9480F` (적갈색 점) | `#FFE8CC` | `#C92A2A` |
| Stage 6 | 최종 (Final) | `#0CA678` (녹색 점) | `#E6FCF5` | `#099268` |

### 2.3 기업 이니셜 아바타 컬러 팔레트 (Company Avatar Palette)

상표권 로고 대신 기업명의 첫 글자를 딴 8종의 절제된 뮤트 톤 배경 아바타를 적용합니다. (`.avatar--0` ~ `.avatar--7`)

| 클래스 | 배경색 (라이트) | 텍스트 | 권장 계열 |
|---|---|---|---|
| `.avatar--0` | `#4E5968` | `#FFFFFF` | Slate Cool Gray |
| `.avatar--1` | `#3182F6` | `#FFFFFF` | Electric Blue |
| `.avatar--2` | `#0CA678` | `#FFFFFF` | Forest Teal |
| `.avatar--3` | `#D97706` | `#FFFFFF` | Amber Gold |
| `.avatar--4` | `#7950F2` | `#FFFFFF` | Deep Violet |
| `.avatar--5` | `#D6336C` | `#FFFFFF` | Crimson Rose |
| `.avatar--6` | `#099268` | `#FFFFFF` | Mint Emerald |
| `.avatar--7` | `#495057` | `#FFFFFF` | Charcoal Gray |

*아바타 규격*: 기본 36×36px, 소형 28×28px, 8px 모서리 곡률(`border-radius: 8px`).

---

## 3. 타이포그래피 스케일 (Typography Scale)

- **글꼴 스택**:
  `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`
- **단일 가변 WOFF2**: `/vendor/pretendard/pretendardvariable.css`를 통해 로컬 서빙 (CDN 금지).

| 레벨 | 폰트 크기 | 굵기 (Weight) | 행간 (Line-height) | 자간 (Letter-spacing) | 사용 처 |
|---|---|---|---|---|---|
| Page Title | 27px (1.6875rem) | 700 (Bold) | 1.3 | -0.02em | 페이지 메인 헤더 (`<h1>`) |
| Section Title | 17px (1.0625rem) | 700 (Bold) | 1.4 | -0.015em | 섹션 카드 타이틀 (`<h2>`) |
| Subsection Title | 15px (0.9375rem) | 600 (Semibold) | 1.4 | -0.01em | 하위 카드/그룹 타이틀 (`<h3>`) |
| Body | 15px (0.9375rem) | 400 (Regular) | 1.5 | 0 | 기본 본문, 폼 입력 텍스트 |
| Body Medium | 15px (0.9375rem) | 500 (Medium) | 1.5 | 0 | 버튼, 강조 본문 |
| Small | 13px (0.8125rem) | 400/500 | 1.4 | -0.005em | 테이블 보조 텍스트, 네비게이션 |
| Caption / Meta | 12px (0.75rem) | 400/600 | 1.35 | 0 | 날짜 힌트, 배지, 툴팁, kbd |
| Key Stat Number | 32px ~ 40px | 700 (Bold) | 1.1 | -0.02em | 대시보드 메인 단일 핵심 지표 |

> **숫자 표기 규칙**: 수치, 카운트, 날짜, 시간 데이터는 항상 `font-variant-numeric: tabular-nums`를 지정합니다.

---

## 4. 간격 시스템 및 모서리 곡률 (Spacing & Radius)

### 4.1 간격 (4px 그리드 스케일)
- `--space-1`: `4px`
- `--space-2`: `8px`
- `--space-3`: `12px`
- `--space-4`: `16px`
- `--space-5`: `20px`
- `--space-6`: `24px`
- `--space-8`: `32px`
- `--space-10`: `40px`
- `--space-12`: `48px`

### 4.2 모서리 곡률 (Border Radius)
- `--radius-xs`: `4px` (태그, kbd)
- `--radius-sm`: `6px` (작은 폼 컨트롤, 버튼)
- `--radius-md`: `8px` (표준 버튼, 입력창, 아바타, 테이블 행)
- `--radius-lg`: `12px` (서브 카드, 모달)
- `--radius-xl`: `16px` (메인 대시보드 카드, 셸 컨테이너)
- `--radius-pill`: `9999px` (상태 배지, 카운터 pill)

### 4.3 그림자 (Elevation Shadows)
과도한 깊이감이나 번짐 없이 매우 은은한 2단계 그림자를 적용합니다.
- `--shadow-sm`: `0 1px 2px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.02)`
- `--shadow-md`: `0 4px 12px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.03)`
- `[data-theme="dark"]` 시 `rgba(0, 0, 0, 0.25)` 및 `rgba(0, 0, 0, 0.4)`로 치환.

---

## 5. 레이아웃 구조 (App Shell Architecture)

```
+---------------------------------------------------------------------------------------------+
| SIDEBAR (248px)     | TOPBAR (56px) - Breadcrumb, Search (⌘K), Quick Action, Bell, Avatar   |
|---------------------+-----------------------------------------------------------------------|
| [ReadySetJob.]      | MAIN CONTENT AREA (max-width: 1200px, padding: 24px)                  |
| [2025 하반기 시즌 v] |  - Page Header (Title + Inline Summary + Action Button)               |
|                     |  - Dashboard Grid: Center Stream (~820px) + Right Rail (~300px)       |
| [메뉴]              |                                                                       |
|  - 대시보드 (Active) |                                                                       |
|  - 지원 관리 (9)    |                                                                       |
|  - 자기소개서       |                                                                       |
|  - 채용 공고        |                                                                       |
|  - 기업             |                                                                       |
|  - 자료함           |                                                                       |
|  - 일정             |                                                                       |
|  - 할 일 (3)        |                                                                       |
|  - 면접 준비        |                                                                       |
|  - 통계             |                                                                       |
| [즐겨찾는 지원]     |                                                                       |
|  - 토스 (FE)        |                                                                       |
|  - 네이버 (FE)      |                                                                       |
|                     |                                                                       |
| [6월 지원목표 14/20] |                                                                       |
| [설정]              |                                                                       |
| [김지민 / 테마 / 로그아웃]                                                                   |
+---------------------+-----------------------------------------------------------------------+
```

- **좌측 사이드바 (`.sidebar`)**:
  - 너비: 고정 `248px`
  - 배경: `--color-surface` (`#FFFFFF`), 우측 경계선 `1px solid var(--color-border)`
  - 활성 메뉴 아이템: 배경 `--color-surface-selected` (`#EFF3F8`), 좌측 3px 인디케이터 바(`border-left: 3px solid var(--color-primary)`), 텍스트 볼드.
- **상단바 (`.topbar`)**:
  - 높이: 고정 `56px`
  - 배경: `--color-surface`, 하단 경계선 `1px solid var(--color-border)`
  - 구성: 모바일 햄버거 토글, 워크스페이스 경로(Breadcrumb), 검색창(단축키 `⌘K`), 빠른 실행 드롭다운, 알림 벨(Unread Dot), 사용자 프로필 아바타.
- **본문 영역 (`.content`)**:
  - 최대 너비: `1200px` (중앙 정렬)
  - 내부 여백: 데스크톱 `24px` (`--space-6`), 모바일 `16px` (`--space-4`)
- **반응형 브레이크포인트**:
  - `< 1024px`: 사이드바가 오프캔버스(Off-canvas) 드로어로 전환되며 오버레이 배경 클릭 시 닫힘.
  - `< 640px`: 우측 패널 및 다단 그리드가 단일 컬럼으로 축소, 테이블은 가로 스크롤 허용.

---

## 6. 주요 컴포넌트 명세 (Components Specification)

### 6.1 버튼 (Buttons)
- **Primary (`.btn-primary`)**: 배경 `#3182F6`, 텍스트 흰색, 호버 `#1B64DA`. 페이지당 메인 액션 1~2개로 제한.
- **Secondary (`.btn`)**: 배경 `#FFFFFF`, 테두리 `1px solid var(--color-border-strong)`, 텍스트 `--color-text`.
- **Ghost (`.btn-ghost`)**: 테두리 없음, 투명 배경, 호버 시 `--color-surface-subtle`.
- **Danger (`.btn-danger`)**: 배경 `#F03E3E`, 호버 `#C92A2A`, 삭제/취소 등 파괴적 행동에만 사용.
- **Sizes**:
  - `.btn-sm`: 높이 28px, 폰트 13px, 패딩 4px 10px, 곡률 6px
  - 기본: 높이 36px, 폰트 14px, 패딩 8px 14px, 곡률 8px
  - `.btn-lg`: 높이 44px, 폰트 15px, 패딩 10px 18px, 곡률 8px

### 6.2 입력/선택 컨트롤 (Inputs, Select, Checkbox)
- **Input / Select (`.input`)**: 높이 36px, 배경 `--color-surface`, 테두리 `1px solid var(--color-border-strong)`, 곡률 8px. 포커스 시 `border-color: #3182F6; box-shadow: 0 0 0 3px rgba(49, 130, 246, 0.15)`.
- **Checkbox**: 16×16px, 곡률 4px, 체크 시 `#3182F6` 배경 및 흰색 체크마크 SVG.
- **키보드 힌트 (`.kbd`)**: 폰트 11px, 패딩 2px 6px, 곡률 4px, 배경 `--color-surface-subtle`, 테두리 `1px solid var(--color-border)`.

### 6.3 카드 & 서피스 (Cards & Surfaces)
- **기본 카드 (`.card`)**: 배경 `#FFFFFF`, 테두리 `1px solid var(--color-border)`, 곡률 12px 또는 16px, 부드러운 그림자 `--shadow-sm`.
- **하이라이트 카드 ("가장 가까운 마감")**: 파란색 단색 배경을 금지하고, 흰색 순수 서피스에 좌측 은은한 테두리 강조 또는 절제된 배지 레이아웃을 채택합니다.

### 6.4 테이블 (Tables)
- 행 높이: 표준 `56px` (`.table tr`).
- 셀 구조: 기업 아바타(28px/36px) + 2줄 셀(굵은 제목 + 보조 직무/설명 13px 텍스트).
- 호버: 행 호버 시 `--color-surface-subtle` 하이라이트.

### 6.5 배지 & 상태 인디케이터 (Badges & Stage Dots)
- **디데이 배지 (`.badge--dday-*`)**:
  - 긴급(D-Day, D-1, D-2): 소프트 레드 배경(`#FFF5F5`) + 텍스트(`#C92A2A`)
  - 임박(D-3, D-4): 소프트 옐로 배경(`#FFF9DB`) + 텍스트(`#D9480F`)
  - 여유: 소프트 블루 배경(`#EDF4FF`) + 텍스트(`#1B64DA`)
- **6단계 진행 점 (`.stepper-dots`)**:
  - 6개의 8px 점(Dot) 배열.
  - 완료된 단계: 채워진 파란 점(`#3182F6`).
  - 현재 단계: 링 아웃라인 포커스 점.
  - 미진행 단계: 비활성 연회색 점(`#E4E9EF`).

### 6.6 세그먼트 탭 & 탭 (Segmented Tabs)
- 배경 `--color-surface-subtle` 안에 모서리 8px 라운드 컨테이너.
- 선택된 탭: 흰색 서피스 pill 카드 + 미세 그림자.

### 6.7 타임라인 & 체크리스트 (Weekly Timeline & Todos)
- **주간 일정**: 요일/날짜 세로 카드 스택 또는 수평 5일 노드.
- **할 일 체크리스트**: 16px 체크박스, 완료 항목은 취소선(`text-decoration: line-through`) 및 뮤트 텍스트.

### 6.8 피드백 (Flash & Empty States)
- **플래시 메시지 (`.flash`)**: 성공(소프트 그린), 오류(소프트 레드), 12px 마진.
- **빈 상태 (`.empty-state`)**: 40px 패딩, 절제된 안내 문구, 행동 유도 버튼(CTA).

---

## 7. 다크 테마 규칙 (Dark Theme Rules)

1. `html[data-theme="dark"]` 속성을 통해 전환되며, `localStorage('rsj_theme')`에 상태를 영속화합니다.
2. 검은색 순수 0% (`#000000`) 배경 대신 편안한 눈부심 방지 쿨 다크 톤(`#0E1117`, `#161B22`)을 사용합니다.
3. 테두리선은 `#30363D`로 명암 대비를 조절하고, 텍스트 대비율은 WCAG AA(4.5:1 이상)를 충족합니다.
4. 다크 모드에서도 원색 블루(`#3182F6`)는 동일하게 유지되어 브랜드 일관성을 보장합니다.

---

## 8. 금지 목록 (Forbidden / Anti-Patterns)

1. **3D 일러스트 및 입체 캘린더 금지**: 3D 그래픽이나 입체적인 오브젝트는 일체 금지하며, 일관된 1.5px stroke의 인라인 SVG 아이콘(Lucide 스타일) 또는 대형 타이포그래피 숫자를 사용합니다.
2. **화려한 그라데이션 금지**: 배경이나 카드에 복잡한 다색 메시 그라데이션을 적용하지 않습니다.
3. **이모지 아이콘화 금지**: 버튼이나 네비게이션 아이콘으로 유니코드 이모지(🚀, 📅 등)를 쓰지 않고 정형화된 SVG 아이콘을 사용합니다.
4. **다색 파스텔 남용 및 과도한 파란색 채움 금지**: 화면 전체가 하늘색/파란색으로 뒤덮이지 않도록 중립 캔버스(`#F7F8FA`)와 흰색 카드 서피스를 기본으로 유지합니다.
5. **가짜 지표 및 데코레이션 더미 금지**: 실제 비즈니스 로직과 연결되지 않는 장식성 가짜 통계나 차트를 배치하지 않습니다.
6. **인라인 스타일 및 스크립트 금지**: CSP 정책(`default-src 'self'`)에 위배되는 `style="..."`, `onclick="..."`, `<script>` 인라인 태그를 엄격히 금지합니다.
