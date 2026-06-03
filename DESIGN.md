---
name: YUI
description: Embodied desktop VRM companion — invisible-by-default UI, warm-when-present.
---

<!-- SEED: re-run /impeccable document once there's code (chat bubble, input, tool-status) to capture the actual tokens and components. -->

# Design System: YUI

## 1. Overview

**Creative North Star: "The Hearthlight"**

YUI의 UI는 난로의 잔불 같은 것이다. 방 한켠에서 따뜻하게 켜져 있되 시선을 강탈하지 않는다. 무대의 주인공은 캐릭터고, 인터페이스는 할 말이 있을 때만 잠깐 켜졌다가 다시 어둠으로 물러난다. 색은 거의 무채색 중립이고, 온기는 작은 앰버 한 점이 담당한다. 폰트는 따뜻한 humanist sans, 모션은 은은한 피드백뿐. 이 시스템의 본분은 *물러서는 것*이다.

UI는 투명·always-on-top 창에서 임의의 데스크톱 배경 위에 떠 있다. 그래서 모든 표면은 무거운 컨테이너 없이도 *어떤 바탕에서든* 읽혀야 한다. 표면화되는 surface는 셋뿐이다 — 발화 말풍선, 텍스트 입력, 툴상태 인디케이터. 이들이 시스템의 전부이자 signature다.

이 시스템이 명시적으로 거부하는 것: 우하단 SaaS 챗봇 위젯(Intercom/Drift류), 메신저 채팅 리스트(Discord/Slack), 옛날 데스크톱 마스코트(Clippy)의 들이대는 말풍선. YUI는 위젯도 메신저도 마스코트도 아니다.

**Key Characteristics:**
- Invisible-by-default: 평소 UI는 사라져 있고, 캐릭터/데스크톱이 무대를 채운다.
- Warm-when-present: 나타날 땐 작은 앰버 온기 + humanist 따뜻함.
- Legible-on-anything: 투명 창 위 임의 배경에서도 자체 대비로 읽힌다.
- Calm motion: 은은한 피드백 전이, 안무 없음, reduced-motion 존중.

## 2. Colors

거의 무채색의 따뜻한 중립 위에, 온기를 담당하는 앰버 한 점. (Restrained 전략)

> SEED: 정확한 값은 구현 때 확정. OKLCH 방향만 명시한다(프로젝트 doctrine = OKLCH, `#000`/`#fff` 금지, 모든 중립은 브랜드 hue로 미세 틴트).

### Primary
- **Hearth Amber** (`oklch(~78% 0.12 ~70)`, 정확값 `[구현 때 확정]`): 온기·강조의 유일한 액센트. 활성 입력 테두리, 발화 시작 신호, 호버 피드백 같은 *순간*에만. 표면의 ≤10%.

### Neutral
- **Warm Ink** (`oklch(~22% 0.01 ~70)`, `[구현 때 확정]`): 본문 텍스트. 순흑 아님 — 앰버 hue로 미세 틴트.
- **Warm Ash** (`oklch(~60% 0.008 ~70)`): 라벨·타임스탬프·부차 텍스트.
- **Scrim** (`oklch(~20% 0.01 ~70 / 0.55~0.7)`): 말풍선 등 떠 있는 표면의 반투명 바탕. 임의 배경 위 가독을 만드는 핵심 (4번 Float 참고).

### Named Rules
**The 10% Warmth Rule.** Hearth Amber는 어떤 화면에서도 ≤10%. 희소함이 곧 온기다 — 흔해지면 브랜딩처럼 읽혀 invisible-by-default가 깨진다.

**The Legible-on-Anything Rule.** 텍스트를 얹는 모든 표면은 *자체 대비*(scrim/backdrop)를 가진다. 데스크톱 배경에 가독을 의존하지 않는다.

## 3. Typography

**Display/Body Font:** 단일 humanist sans `[구현 때 선정 — geometric 말고 humanist, 따뜻하고 약간 둥근 계열]`
**Label Font:** 같은 패밀리의 작은 트래킹 변형 (별도 mono 도입 안 함 — 도구 느낌 회피)

**Character:** 따뜻하고 약간 둥근 humanist sans. 작은 크기(말풍선·라벨)에서도 또렷하고, 차갑거나 기계적이지 않다.

### Hierarchy
- **Display** (`[weight ~600]`, `clamp` `[확정]`): 캐릭터 이름 등 희소한 순간만.
- **Title** (`~600`, `~1.0rem`): 말풍선 내 강조, 툴 결과 제목.
- **Body** (`~400`, `~0.95rem`, line-height `~1.5`): 발화 텍스트. 대화체 짧은 호흡 위주 — 긴 문서 폭(65–75ch)이 아니라 말풍선 폭에 맞춘 좁은 컬럼.
- **Label** (`~500`, `~0.75rem`, 약한 대문자 트래킹): 툴상태("검색 중…"), 타임스탬프.

### Named Rules
**The Speech-First Rule.** 본문 타입은 말풍선 속 짧은 대화 버스트에 최적화한다. 문서 레이아웃 규칙(긴 행폭, 촘촘한 단)을 끌어오지 않는다.

## 4. Elevation

기본은 평평하다. 깊이는 그림자 더미가 아니라, 떠 있는 표면 하나에 *부드러운 앰비언트 그림자 1겹*으로만 만든다. 투명 창 위에서 그림자는 UI를 임의 배경에서 분리하는 기능적 장치다 — 장식이 아니다.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 32px oklch(0% 0 0 / ~0.28)`, `[확정]`): 말풍선·툴칩 등 떠오른 표면 1겹. 게임 HUD 네온 글로우나 딱딱한 drop shadow 금지.

### Named Rules
**The Float Rule.** UI 표면은 단 한 겹의 부드러운 앰비언트 그림자로 데스크톱 위에 뜬다. 다중 그림자·하드 드롭섀도우·네온 글로우는 금지.

## 6. Do's and Don'ts

> SEED: 컴포넌트(말풍선·입력·툴상태)가 생기면 5번 Components 채우고 scan 모드로 재생성.

### Do:
- **Do** 중립을 전부 앰버 hue로 미세 틴트(chroma ~0.005–0.01). `#000`/`#fff` 금지, OKLCH 사용.
- **Do** Hearth Amber를 ≤10%로, *순간*(활성 입력·발화 신호·호버)에만.
- **Do** 떠 있는 표면에 자체 scrim(반투명 바탕)을 줘서 임의 배경 위 가독 확보 — 단 *가독이 필요한 곳에만*(말풍선), 장식용 아님.
- **Do** 모션은 Responsive로: 부드러운 등장/사라짐 + 피드백. ease-out 지수 곡선. `prefers-reduced-motion` 시 전이를 조용히 약화.
- **Do** 평평하게 두고, 떠오를 때만 Float 그림자 1겹.

### Don't:
- **Don't** 우하단 **SaaS 챗봇 위젯**처럼 만들기 (보더 카드, 그라데이션 액센트, 제네릭 위젯 톤).
- **Don't** **메신저 앱**(Discord/Slack/카톡)처럼 채팅 리스트·메시지 행·채널 크롬 쌓기.
- **Don't** **옛날 데스크톱 마스코트**(Clippy)처럼 촌스럽게 들이대는 말풍선.
- **Don't** 장식용 glassmorphism 남발. 프로스트 backdrop은 *가독을 위한 말풍선 1곳*에서만 purposeful하게, 아니면 쓰지 않기.
- **Don't** side-stripe 보더(1px 초과 컬러 좌/우 줄), gradient text(`background-clip:text`), 동일 카드 그리드, 모달-우선.
- **Don't** 앰버를 면(面)으로 깔기 — 온기는 점(點)이다(10% Warmth Rule).
