<!-- 제목: 관련 feature/이슈가 드러나게. 예: "[F1] VRM 로드 + 핫스왑" -->

## 변경 요약
<!-- 무엇을, 왜 -->

## 관련 이슈
<!-- Closes #__ -->

## 관련 결정 / 문서
<!-- 건드린 docs: contract.md / prd.md(D-*) / event-dispatcher.md -->

## 검증
- [ ] `cargo check` 통과 (Rust 변경 시)
- [ ] `pnpm build` 통과 (tsc 타입체크 포함)
- [ ] 필요 시 `pnpm tauri dev`로 실제 동작 + 스크린샷 확인

## 체크리스트 (YUI 원칙)
- [ ] 스키마 변경은 `docs/contract.md`를 **먼저** 수정한 뒤 코드 반영
- [ ] 미검증 가정 없음 (web/context7 cross-check, docs 우선)
- [ ] client에 brain 추가 안 함 — judgment/persona/모드는 backend (firing ≠ judgment)
- [ ] inline 제어 태그 금지 — 제어는 `express` tool-call arguments로만
- [ ] 하드코딩 금지 — 엔드포인트/모델/경로는 `configs/`
