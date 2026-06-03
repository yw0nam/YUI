# Product

## Register

product

## Users

개인용 우선(현재는 개발자 본인), 추후 OSS 공개 대비.

사용 맥락: 하루 종일 컴퓨터 앞. YUI 캐릭터는 투명·always-on-top 오버레이로 **데스크톱 위에 상주**한다 — 별도 창을 열어 "사용하는" 앱이 아니라, 작업 공간 한켠에 살아 있는 존재.

하려는 일(job-to-be-done): 곁에 살아 있는 동반자. 텍스트·음성으로 대화하고, 화면 맥락을 알아채고, 가끔 먼저 말을 거는 캐릭터. 두뇌(판단·기억·툴·페르소나)는 Hermes 백엔드가 맡고, YUI는 그 **head**(렌더 + 센싱 + I/O 표면)만 담당.

## Product Purpose

Hermes Agent(brain)의 embodied frontend(head). VRM 캐릭터를 데스크톱 펫으로 렌더하고, 입력(텍스트·음성·화면)을 센싱하고, TTS+립싱크로 말하고, 챗/툴상태를 표시하고, 선제 트리거를 *발사*한다 — 단 **모든 판단은 백엔드에 위임**한다(`firing ≠ judgment`).

성공의 모습: **UI가 끼어들지 않고 캐릭터가 살아 있는 것처럼 느껴진다.** 사용자는 챗 앱을 *조작*하는 게 아니라 캐릭터와 *함께 있다*.

## Brand Personality

세 단어: **따뜻함 · 존재감 · 비간섭**(warm, present, unobtrusive).

성격의 주체는 캐릭터다. UI 크롬의 본분은 **물러서는 것**. 평소엔 거의 보이지 않다가(캐릭터가 무대의 주인공), 말풍선·툴상태·입력처럼 꼭 필요해 나타날 때만 모습을 드러내고 그때는 따뜻하고 characterful하다. 정서 목표: 도구가 아니라 **곁에 있는 살아 있는 존재**.

핵심 톤 한 줄: **invisible-by-default, warm-when-present.**

## Anti-references

- **기업용 SaaS 챗봇 위젯**(Intercom/Drift류): 우하단 말풍선 위젯, 보더 카드, 그라데이션 액센트, 제네릭 SaaS 톤. YUI는 위젯이 아니다.
- **메신저 앱**(Discord/Slack/카카오톡): 채팅 리스트·메시지 행·채널 크롬. YUI는 대화 로그를 운영하는 앱이 아니다.
- **옛날 데스크톱 마스코트**(Clippy/Office 어시스턴트): 촌스럽고 들이대는 말풍선, 개그성 간섭. 비간섭 원칙과 정반대.

(게임 HUD/SF 오버레이 레인은 거부 대상이 아님 — 중립적으로 허용.)

## Design Principles

1. **캐릭터가 주인공, UI는 무대 뒤 스태프.** 크롬은 기본적으로 물러서 있고, 할 말이 있을 때만 나타났다가 다시 비킨다. (invisible-by-default)
2. **나타날 땐 따뜻하게.** UI가 표면화될 때(말풍선·툴상태·입력)는 characterful하고 따뜻하게 — 절대 기업용 위젯처럼은 아니게. (warm-when-present)
3. **UI에서도 `firing ≠ judgment`.** 클라이언트는 백엔드가 정한 상태를 *렌더*만 한다. UI가 페르소나·모드·의견을 지어내지 않는다. 표면은 백엔드 신호를 반영하지 발명하지 않는다.
4. **무엇 위에서도 읽힌다.** UI는 투명 창에서 임의의 데스크톱 배경 위에 떠 있다. 무거운 컨테이너 없이도 모든 표면이 어떤 바탕에서든 legible해야 한다.
5. **기본은 차분, 주의는 존중.** Ambient liveliness는 은은하게, reduced-motion을 존중하고, 주의를 강탈하지 않는다(rate-limit·DND 인지). 동반자는 보채지 않는다.

## Accessibility & Inclusion

- **확정 요구 — reduced-motion 존중:** Tier 1 ambient(blink/sway/숨쉬기)와 UI 전이는 항상 돌아가므로, OS `prefers-reduced-motion` 시 조용히 약화한다(멀미·집중 방해 방지).
- **현재 범위 = 개인용 최소.** 위 항목 외에는 기본 수준만. **OSS 단계에서 강화 예정(미루지만 인지):** 감정/툴상태를 색에만 의존하지 않기(색맹 안전), 임의 배경 위 고대비 텍스트(WCAG 대비). 지금은 deferred.
