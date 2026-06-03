---
name: Feature / Task
about: PRD feature(F1–F9) 또는 마일스톤(M0–M4)에 묶이는 빌드 작업
title: "[Fx] "
labels: ["feature"]
---

## 관련 (PRD / 결정)
<!-- 예: F4 Output, D-TTS-PIPELINE. docs/prd.md · docs/contract.md 참조 -->
- Feature:
- 결정 로그(D-*):
- 마일스톤(M0–M4):

## 작업 내용
<!-- 무엇을 만드는가. 한 이슈 = 한 작업 단위 -->

## Acceptance criteria
<!-- "이게 되면 done". docs/prd.md의 해당 feature acceptance를 그대로 옮겨오기 -->
- [ ]

## 의존성
<!-- 선행 feature/이슈, contract 산출물 -->

## 참고 문서
- `docs/`:

## 체크리스트
- [ ] 스키마를 건드리면 `docs/contract.md`를 **먼저** 수정 (코드는 그 다음)
- [ ] 미검증 가정 없음 (필요 시 web/context7 cross-check 후 docs에 기록)
- [ ] client에 brain 추가 안 함 (firing ≠ judgment)
- [ ] `cargo check` + `pnpm build` 통과
