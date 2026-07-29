/**
 * Korean strings.
 * tool.* keys stay English (same as en) — not translated per spec.
 */
const ko: Record<string, string> = {
  // tool labels (English — not translated)
  "tool.web_search": "Searching…",
  "tool.browser": "Browsing…",
  "tool.terminal": "Running…",
  "tool.code": "Running…",
  "tool.python": "Running…",
  "tool.file": "Reading…",
  "tool.read_file": "Reading…",
  "tool.write_file": "Writing…",

  // voice state labels
  "voice.state.idle": "대기 중",
  "voice.state.listening": "듣는 중…",
  "voice.state.processing": "처리 중…",
  "voice.state.speaking": "말하는 중…",
  "voice.state.asr": "ASR 전송",
  "voice.state.fired": "전달됨",
  "voice.state.error": "오류",

  // aria labels (parameterized)
  "aria.refresh_speaker": "{name} 참조 음성 갱신",
  "aria.refresh_speaker_refreshing": "{name} 참조 음성 갱신 중",
  "aria.refresh_speaker_done": "{name} 참조 음성 갱신됨",
  "aria.preview_speaker": "{name} 미리듣기",
  "aria.voice_input": "음성 입력: {label}",

  // surfaces (speech bubble · tool-status · text input)
  "aria.attach_image": "이미지 첨부",
  "aria.input_field": "YUI에게 말 걸기",
  "aria.send": "보내기",
  "aria.stop": "멈추기",
  "aria.remove_attachment": "첨부 제거",
  "input.placeholder": "말 걸기…",
  "input.error_auth": "인증 실패 · API 키 확인",
  "input.error_network": "응답 없음 · 연결 확인",
  "input.error_parse": "응답 처리 실패",

  // chain-break (404) recovery notice
  "chain.reset_notice": "대화 컨텍스트가 초기화되었습니다",

  // boot-failure notice
  "boot.error_title": "YUI를 시작하지 못했습니다",
  "boot.error_config": "설정을 불러오지 못했습니다 — {file}",
  "boot.error_vrm":
    "VRM 모델을 찾을 수 없습니다 — resources/vrms/에 .vrm 파일을 넣고 다시 시작하세요.",
  "boot.error_dismiss": "닫기",

  // capture indicator
  "capture.watching": "화면 보는 중",

  // cue-list internal labels
  "cue.time_aria": "시각",
  "cue.greeting_time_aria": "인사 시각",
  "cue.minutes_word": "대화 없이",
  "cue.minutes_aria": "대화 없는 시간(분)",
  "cue.minutes_suffix": "분마다",
  "cue.toggle_aria": "{name} 활성화",
  "cue.toggle_fallback": "큐",
  "cue.delete": "삭제",
  "cue.confirm_q": "삭제할까요?",
  "cue.confirm_go": "삭제",
  "cue.confirm_cancel": "취소",
  "cue.name_label": "이름",
  "cue.name_aria": "이름",
  "cue.ctx_label": "컨텍스트",
  "cue.ctx_aria": "AI가 읽을 컨텍스트",
  "cue.ctx_placeholder": "AI가 참고할 상황 설명을 자유롭게 적어요…",

  // panel chrome
  "panel.dialog_label": "설정",
  "panel.title": "설정",
  "panel.tablist_label": "설정 영역",
  "panel.drag_hint": "드래그해서 옮기기",
  "panel.pop_out": "창으로 빼기",
  "panel.close": "닫기",
  "panel.rail_collapse": "섹션 목록 접기",
  "panel.rail_expand": "섹션 목록 펼치기",
  "devtools.label": "개발자 도구",
  "devtools.sub": "전송 컨텍스트와 모션 미리보기",
  "devtools.open": "열기",
  "devtools.nav_aria": "개발자 도구 섹션",
  "devtools.nav.context": "컨텍스트 검사기",
  "devtools.nav.advanced": "고급 설정",
  "devtools.nav.motion": "모션 미리보기",
  "devtools.loading_motion": "모션 미리보기 불러오는 중…",
  "devtools.motion_load_failed":
    "모션 미리보기를 불러오지 못했습니다. 이 탭을 다시 선택하면 재시도합니다.",
  "devtools.inspector.turns_aria": "최근 턴",
  "devtools.inspector.empty_title": "아직 전송된 컨텍스트가 없어요",
  "devtools.inspector.empty_sub": "성공한 턴이 여기에 표시돼요.",
  "devtools.inspector.off": "꺼짐",
  "devtools.inspector.baseline_only": "기본 정보만",
  "devtools.signal.active_app": "앱",
  "devtools.signal.active_window_title": "제목",
  "devtools.signal.posture": "자세",
  "devtools.signal.recent_apps": "최근 앱",
  "devtools.signal.screenshot": "스크린샷",
  "devtools.advanced.context_signals": "컨텍스트 신호",
  "devtools.advanced.recent_apps_label": "최근 앱",
  "devtools.advanced.recent_apps_sub": "포그라운드 앱 변경 기록 포함",
  "devtools.advanced.active_app_label": "활성 앱",
  "devtools.advanced.active_app_sub": "현재 포그라운드 앱 포함",
  "devtools.advanced.window_title_label": "창 제목",
  "devtools.advanced.window_title_sub": "활성 창 제목 포함",
  "devtools.advanced.posture_label": "자세",
  "devtools.advanced.posture_sub": "캐릭터의 현재 자세 포함",
  "devtools.advanced.limits": "제한",
  "devtools.advanced.recent_apps_cap_label": "최근 앱 상한",
  "devtools.advanced.recent_apps_cap_sub": "저장할 앱 전환 기록의 최대 개수",
  "devtools.advanced.context_window_label": "컨텍스트 창(토큰)",
  "devtools.advanced.context_window_sub": "비워 두면 내장 엔드포인트 설정을 사용해요",
  "devtools.advanced.context_window_default": "기본값",

  // tabs
  "tabs.talk": "대화",
  "tabs.char": "캐릭터",
  "tabs.input": "입력",
  "tabs.adv": "고급",
  "tabs.react": "반응",

  // reasoning effort segment
  "reasoning.label": "추론 강도",
  "reasoning.sub": "답변 전 얼마나 깊게 생각할지",
  "reasoning.none": "없음",
  "reasoning.minimal": "최소",
  "reasoning.low": "낮음",
  "reasoning.medium": "중간",

  // instructions
  "instructions.label": "지침",
  "instructions.sub": "비우면 기본 지침을 사용해요",
  "instructions.reset": "기본값으로 되돌리기",
  "instructions.placeholder_default": "기본 지침을 사용 중이에요",

  // filler (thinking interjections)
  "filler.section": "생각중 추임새",
  "filler.enable_label": "추임새 사용",
  "filler.enable_sub": "답변을 기다리는 동안 짧은 말을 해요",
  "filler.lang_label": "언어",
  "filler.lang_sub": "추임새를 말할 언어",
  "filler.lang_aria": "추임새 언어",
  "filler.first_label": "첫 대사",
  "filler.first_sub": "유저 메시지가 들어오면 바로 한 번 재생",
  "filler.first_aria": "첫 대사 목록",
  "filler.repeat_label": "반복 대사",
  "filler.repeat_sub": "첫 대사 뒤, 응답이 올 때까지 1초 간격으로 반복 재생",
  "filler.repeat_aria": "반복 대사 목록",
  "filler.hint": "두 목록 모두 비워두면 기본 문구를 사용해요. 한 줄에 하나씩 입력해요.",

  // language picker
  "language.label": "언어",
  "language.sub": "이 앱의 표시 언어",
  "language.aria": "표시 언어",

  // VRM section
  "vrm.section": "VRM",
  "vrm.group_aria": "VRM",
  "vrm.add": "파일에서 추가…",
  "vrm.import_error": "불러올 수 없는 파일이에요. VRM 파일인지 확인해 주세요.",
  "vrm.in_use": "사용 중",
  "vrm.rename": "이름 바꾸기",
  "vrm.remove": "삭제",
  "vrm.name_aria": "VRM 이름",
  "vrm.import_overwrite_warn": "같은 이름의 기존 모델을 덮어써요",
  "vrm.rename_hint_save": "저장",
  "vrm.rename_hint_cancel": "취소",
  "vrm.loading": "불러오는 중…",
  "vrm.swapping": "바꾸는 중…",
  "vrm.swap_error": "이 모델을 불러오지 못했어요. 이전 모델로 되돌렸어요.",

  // speaker section
  "speaker.section": "음성",
  "speaker.engine_label": "음성 엔진",
  "speaker.engine_sub": "캐릭터 목소리를 만드는 합성 엔진",
  "speaker.engine_aria": "음성 엔진",
  "speaker.engine_irodori": "irodori",
  "speaker.engine_openai": "OpenAI 호환",
  "speaker.openai_hint": "irodori 전용이에요. OpenAI 호환 엔진은 서버에 설정된 voice로 말해요.",
  "speaker.group_aria": "화자",
  "speaker.add": "파일에서 추가…",
  "speaker.import_error":
    "이 음성을 등록하지 못했어요. 오디오 파일과 irodori 서버를 확인해 주세요.",
  "speaker.in_use": "사용 중",
  "speaker.rename": "이름 바꾸기",
  "speaker.remove": "삭제",
  "speaker.refresh": "참조 음성 갱신",
  "speaker.preview": "미리듣기",
  "speaker.name_aria": "화자 이름",
  "speaker.rename_hint_save": "저장",
  "speaker.rename_hint_cancel": "취소",
  "speaker.import_overwrite_warn": "같은 이름의 기존 음성을 덮어써요",
  "speaker.loading": "불러오는 중…",
  "speaker.swapping": "바꾸는 중…",
  "speaker.refreshing": "갱신 중…",
  "speaker.swap_error": "이 화자를 불러오지 못했어요. 이전 화자로 되돌렸어요.",
  "speaker.refresh_error": "참조 음성을 갱신하지 못했어요.",
  "speaker.refresh_done": "참조 음성을 갱신했어요.",

  // expression (lipsync gain)
  "expression.section": "표현",
  "expression.mouth_label": "입 움직임",
  "expression.mouth_sub": "목소리 크기에 따라 입이 벌어지는 정도",
  "expression.mouth_aria": "입 움직임",
  "expression.mouth_hint": "드래그하면 캐릭터 입이 실제로 그만큼 벌어져요",

  // viewpoint (camera orbit)
  "viewpoint.section": "시점",
  "viewpoint.sub": "Shift + 드래그로 회전, 스크롤로 확대",
  "viewpoint.reset": "정면으로 초기화",

  // screenshot / input tab
  "screenshot.label": "스크린샷 첨부",
  "screenshot.sub": "대화할 때 화면을 함께 봐요",
  "screenshot.source_label": "보낼 화면",
  "screenshot.source_aria": "보낼 화면",
  "screenshot.monitor_primary": "주 화면",
  "screenshot.display": "디스플레이 {n}",
  "screenshot.monitors_error": "화면 목록을 불러오지 못했어요.",
  "screenshot.monitors_empty": "감지된 화면이 없어요.",
  "screenshot.foot_on": "켜져 있는 동안 매 대화에 이 화면이 첨부돼요.",
  "screenshot.foot_off": "기본은 꺼져 있어요. 켜면 화면을 함께 보내요.",

  // voice input
  "voice_input.label": "음성 입력",
  "voice_input.sub": "말이 끝나면 STT 후 사용자 입력으로 보내요",
  "voice_input.aria": "음성 입력",
  "voice_input.silence_label": "침묵 기준",
  "voice_input.silence_sub": "말이 끝난 뒤 이만큼 기다렸다가 전송해요",
  "voice_input.silence_aria": "침묵 기준",
  "voice_input.bargein_label": "말 끊기",
  "voice_input.bargein_aria": "말 끊기 (내가 말하면 캐릭터가 멈춤)",

  // TTS output toggle
  "tts_output.label": "음성 출력",
  "tts_output.sub": "TTS로 답변을 읽어줘요. 끄면 텍스트만 표시해요",
  "tts_output.aria": "음성 출력",

  // cue lists (input tab)
  "cue.schedule_title": "시간대 인사",
  "cue.schedule_sub": "정한 시각에 자리에 있으면 먼저 말을 걸어요",
  "cue.schedule_add": "+ 인사 추가",
  "cue.proactive_title": "루프 반응",
  "cue.proactive_sub": "작업 중에 한동안 조용하면 주기적으로 먼저 말을 걸어요",
  "cue.proactive_add": "+ 반응 추가",

  // endpoints
  "endpoints.section": "엔드포인트",
  "endpoints.summary_hint": "고급 — 서버 주소·모델",
  "endpoints.field_sub": "비우면 기본값을 사용해요",
  "endpoints.reset": "기본값으로 되돌리기",
  "endpoints.url_error": "올바른 URL이 아니에요 (http:// 또는 https://)",
  "endpoints.chat_base_url.label": "채팅 서버 URL",
  "endpoints.stt_base_url.label": "음성 인식(STT) 서버 URL",
  "endpoints.tts_base_url.label": "음성 합성(TTS) 서버 URL",
  "endpoints.irodori_base_url.label": "irodori 서버 URL",
  "endpoints.broker_base_url.label": "표현 브로커(Broker) URL",
  "endpoints.chat_model.label": "채팅 모델",

  "endpoints.tts_voice.label": "TTS voice",

  // per-service sections (advanced tab)
  "svc.type_label": "유형",
  "svc.chat": "채팅",
  "svc.chat_aria": "채팅 API 종류",
  "svc.chat_type_responses": "Responses API",
  "svc.chat_type_completions": "Chat Completions",
  "svc.stt": "STT",
  "svc.stt_hint": "OpenAI 호환",
  "svc.stt_type": "OpenAI 호환",
  "svc.tts": "TTS",
  "svc.tts_aria": "TTS 엔진",
  "svc.broker": "Broker",
  "svc.broker_hint": "MCP streamable-http",
  "svc.broker_type": "MCP streamable-http",
  "svc.reset_chat": "채팅 되돌리기",
  "svc.reset_stt": "STT 되돌리기",
  "svc.reset_tts": "TTS 되돌리기",
  "svc.reset_broker": "Broker 되돌리기",

  // chat API key
  "chatkey.section": "채팅 API 키",
  "chatkey.label": "채팅 API 키",
  "chatkey.sub_default": "기본값 사용 중 — 비워두면 빌드 시 설정한 키를 써요",
  "chatkey.sub_override": "이 기기에 저장됨 — 비우면 원래 키로 돌아가요",
  "chatkey.show": "키 보기",
  "chatkey.hide": "키 숨기기",
  "chatkey.clear": "키 지우기",

  // STT API key
  "sttkey.label": "STT API 키",
  "sttkey.sub_default": "기본값 사용 중 — 비워두면 빌드 시 설정한 키를 써요",
  "sttkey.sub_override": "이 기기에 저장됨 — 비우면 원래 키로 돌아가요",
  "sttkey.show": "키 보기",
  "sttkey.hide": "키 숨기기",
  "sttkey.clear": "키 지우기",

  // TTS API key
  "ttskey.label": "TTS API 키",
  "ttskey.sub_default": "기본값 사용 중 — 비워두면 빌드 시 설정한 키를 써요",
  "ttskey.sub_override": "이 기기에 저장됨 — 비우면 원래 키로 돌아가요",
  "ttskey.show": "키 보기",
  "ttskey.hide": "키 숨기기",
  "ttskey.clear": "키 지우기",

  // performance
  "perf.section": "성능",
  "perf.idle_label": "유휴 시 절전 (30fps)",
  "perf.idle_sub":
    "캐릭터가 가만히 있을 때 프레임을 낮춰 전력을 아낍니다. 말하거나 움직일 땐 자동으로 부드러워집니다.",
  "perf.idle_aria": "유휴 시 절전",
  "gaze.label": "카메라 시선 맞춤",
  "gaze.sub": "캐릭터가 카메라 쪽으로 눈과 고개를 돌려 시선을 맞춥니다.",
  "gaze.aria": "카메라 시선 맞춤",
  "agentNotify.label": "에이전트 완료 알림",
  "agentNotify.sub": "Claude Code, opencode 등 코딩 에이전트가 작업을 마치면 먼저 말합니다.",
  "agentNotify.aria": "에이전트 완료 알림",

  // first-run onboarding hint
  "hint.first_run": "우클릭하면 컨트롤이 열려요 · {hotkey}로 말 걸 수 있어요",
  "hint.first_run_no_hotkey": "우클릭하면 컨트롤이 열려요",

  // reactions tab
  "reactions.watchers_title": "감시",
  "reactions.shared_title": "공통",
  "reactions.port_label": "리스너 포트",
  "reactions.port_sub": "완료 훅 서버가 기다릴 포트",
  "reactions.presence_label": "자리 비움 허용 시간",
  "reactions.presence_sub": "이 시간 이하로 자리를 비웠다면 작업 중으로 간주해요",
  "reactions.seconds_suffix": "초",
  "reactions.restart_hint": "변경 사항을 적용하려면 앱을 재시작해요",
  "reactions.recent_apps_label": "최근 앱 기억",
  "reactions.recent_apps_sub": "다음 메시지에 실릴 최근 전환 앱 개수예요",

  // workflows
  "workflows.title": "워크플로",
  "workflows.sub": "저장한 엔드포인트를 바로 실행해요. ▶ 첫 실행으로 연결 상태도 확인할 수 있어요.",
  "workflows.label_label": "이름",
  "workflows.label_ph": "예: 아침 요약",
  "workflows.url_label": "URL",
  "workflows.url_ph": "https://…",
  "workflows.url_error": "올바른 URL을 입력하세요. 예: https://example.com/hook",
  "workflows.add": "추가",
  "workflows.empty": "아직 워크플로가 없어요. 아래에서 추가해 보세요.",
  "workflows.fire_aria": "{name} 실행",
  "workflows.delete_aria": "{name} 삭제",

  // session
  "session.section": "세션",
  "session.context": "Context",
  "session.action_label": "새 대화 시작 · Start fresh",
  "session.action_sub": "새 대화를 시작해요. 그 전까지 YUI는 현재 기억을 유지해요.",
  "session.reset": "대화 초기화 · Reset conversation",
  "session.confirm_q": "새로 시작할까요?",
  "session.confirm_go": "새로 시작",
  "session.confirm_cancel": "취소",
};

export default ko;
