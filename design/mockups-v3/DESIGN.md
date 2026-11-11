# ReadySetJob mockups v3 — design contract

Visual contract is the user brief, not a brand clone. Layer A: `minimalist-skill.md` (quiet paper, type does the structuring, no card soup). Layer B: `notion.md` (warm neutrals, whisper structure, one blue). Toss is not in the curated set; the brief supplies the type scale, numeral size, copy tone, and accent `#3182F6`.

## 0. Research log

- Embedded references: shortlist Notion, Linear, Stripe. Picked Notion + minimalist because the brief asks for a Things/Notion page, not a glossy marketing surface. Read `minimalist-skill.md` and `notion.md` in full.
- Negative references viewed: v1 diagnosis in `design/mockups-v2/README.md`; v2 direction 3 dashboard (white cards on grey, colored KPI borders, pastel D-day pills); existing v3 screenshots (same boxed chrome, editor text sliced).
- Lazyweb / imagen: skipped. The brief is an explicit synthesis (paper chrome + Toss type + stage color only). No network fonts or CDNs. Drafts would not outrank that contract.
- Local font fact: Pretendard and Toss Product Sans are not installed. Stack falls through to Noto Sans CJK KR, which ships Regular and Bold only.

## Direction

A quiet paper desk. The page is warm off-white with black/grey type and almost no chrome. Color is a set of six soft stage washes, used as the card itself — Things tags, not rainbow pills. Numbers are Toss-scale. One blue, used rarely.

Signature: tinted paper blocks with no border and no shadow. The only shadow is the card being dragged.

## Tokens

See `style.css` `:root` and `[data-theme="dark"]`. Do not introduce hex outside those blocks.

- Paper `#F6F5F2`, sunken `#EFEDE8`, ink `#191F28`, secondary `#4E5968`
- Accent `#3182F6` for 40px+ numerals and the progress bar only
- Accent strong `#1B64DA` for solid buttons (white label clears 4.5:1; `#3182F6` + white is 3.7:1)
- Pass `#0F6E3C`. Failed / withdrawn cards `#E8E6E1` / `#5C564F`. No red alarm.
- Stage washes: 서류 `#D4E4F0`, 코딩테스트 `#E0D8F2`, 과제 `#F6E0CC`, 1차 `#F6D9E4`, 2차 `#D4EDDC`, 최종 `#F3E6BC`, each with a darker ink. Contrast of ink on wash is above 6:1.

## Type

Stack: `"Pretendard Variable", Pretendard, "Toss Product Sans", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`.

Weights in use: 400 and 700 only. 500/600 would faux-bold on this machine.

- Page heading 30px / 700 / -0.02em (26px below 960px)
- Numerals 48px desktop, 40px mobile, tabular-nums
- Stage tile numeral 36px
- D-day chip numeral 28px
- Body 15px / 400 / 1.55. Essay 16px / 1.75
- Secondary is size and color, not a mid weight

## Space and radius

4px base: 4, 8, 12, 16, 20, 24, 28, 32, 40, 48.

Radius 14px on tinted cards, 12px on number chips and column headers, 10px on buttons. No full pills. No shadow on resting surfaces.

## Primitives

- `sidenav` — quiet text + 16px stroke icons. Active item is bold, sunken wash, radius 8px.
- `stat` — label over a naked numeral. No tile.
- `tile` — stage wash, label, count, one computed meta line.
- `chip` — sunken number vessel for D-day or a calendar day. Not a status color.
- `row` / `log` — open lists. Whitespace, not boxes.
- `card` — stage wash, company, role, type + time, result mark. `is-dragging`, `is-failed`, `is-passed`.
- `doc` — 700px writing column, borderless prose, counter, 3px bar.
- `ref` — small wash card in the reference rail.
- `diff` — `ins` / `del` on the paper, not inside a panel.
- `seg` — mobile stage switch. Selected chip inverts to that stage's ink.
- `tabbar` — mobile only, in-flow visually fixed, opaque paper.

## Scroll

Desktop: shell is `100dvh`. Sidebar fixed. `main` is the scroll owner (`min-height: 0`). Kanban columns do not scroll; six fit at 1440. Editor document scrolls with `main` if the answer grows — the mock answer is sized to finish inside 900px so no line is sliced by an inner overflow.

Mobile: document scroll. Tab bar fixed. Main padding clears it.

## Motion

Drag is a posed state: translate, -2.5deg, shadow. Button press `scale(0.98)` only, removed under `prefers-reduced-motion`. No hover that does not change a control.

## Accessibility

- Ink on washes ≥ 6:1. Secondary `#4E5968` on paper ≥ 6.5:1.
- One h1 per page. Nav `aria-label`. Stage tabs are `role="tab"`.
- `:focus-visible` outline. No emoji icons.
- Accepted: `#3182F6` on paper is 3.4:1 and is used only at 40px+ and as a 3px bar.

## Accepted debt

- 지원취소 shares the failed grey treatment; the brief's totals (18 / 11 / 2 / 5) include no withdrawn row, so none is shown.
- Dark theme is tokenized, not a screenshot target.
- Primitives are verified on the three product screens. A separate showcase page is outside the requested file list.
