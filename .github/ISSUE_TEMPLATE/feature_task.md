---
name: Feature / Task
about: Build work tied to a feature (F1–F9) or milestone (M0–M4)
title: "[Fx] "
labels: ["feature"]
---

## Related decisions
<!-- Example: F4 Output, D-TTS-PIPELINE. See docs/reference/backend-contract.md. -->
- Feature:
- 결정 로그(D-*):
- 마일스톤(M0–M4):

## 작업 내용
<!-- 무엇을 만드는가. 한 이슈 = 한 작업 단위 -->

## Acceptance criteria
<!-- Copy the relevant feature acceptance criteria. -->
- [ ]

## 의존성
<!-- 선행 feature/이슈, contract 산출물 -->

## 참고 문서
- `docs/`:

## 체크리스트
- [ ] Schema changes update `docs/reference/backend-contract.md` before the code
- [ ] 미검증 가정 없음 (필요 시 web/context7 cross-check 후 docs에 기록)
- [ ] client에 brain 추가 안 함 (firing ≠ judgment)
- [ ] `cargo check` + `pnpm build` 통과
