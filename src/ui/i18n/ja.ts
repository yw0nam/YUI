/**
 * Japanese strings.
 * tool.* keys stay English (same as en) — not translated per spec.
 */
const ja: Record<string, string> = {
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
  "voice.state.idle": "待機中",
  "voice.state.listening": "聞いています…",
  "voice.state.processing": "処理中…",
  "voice.state.speaking": "話しています…",
  "voice.state.asr": "文字起こし中…",
  "voice.state.fired": "送信しました",
  "voice.state.error": "エラー",

  // aria labels (parameterized)
  "aria.refresh_speaker": "{name} の参照音声を更新",
  "aria.refresh_speaker_refreshing": "{name} の参照音声を更新中",
  "aria.refresh_speaker_done": "{name} の参照音声を更新しました",
  "aria.preview_speaker": "{name} を試聴",
  "aria.voice_input": "音声入力: {label}",

  // surfaces (speech bubble · tool-status · text input)
  "aria.attach_image": "画像を添付",
  "aria.input_field": "YUI に話しかける",
  "aria.send": "送信",
  "aria.stop": "停止",
  "aria.remove_attachment": "添付を削除",
  "aria.dismiss_bubble": "吹き出しを閉じる",
  "input.placeholder": "話しかけてみて…",
  "input.error_auth": "認証失敗 · APIキー確認",
  "input.error_network": "応答なし · 接続確認",
  "input.error_stall": "バックエンド応答停止 · {seconds}秒でタイムアウト",
  "input.error_parse": "応答処理に失敗",
  "input.error_not_configured": "バックエンド未設定",
  "input.error_open_advanced": "詳細を開く",
  "input.attach_too_many": "画像が多すぎ · 1ターン{max}枚まで",
  "input.attach_too_large": "画像が大きすぎ · 1枚{max}MBまで",

  // chain-break (404) recovery notice
  "chain.reset_notice": "会話コンテキストがリセットされました",

  // boot-failure notice
  "boot.error_title": "YUI を起動できませんでした",
  "boot.error_config": "設定を読み込めませんでした — {file}",
  "boot.error_vrm":
    "VRM モデルが見つかりません — resources/vrms/ に .vrm ファイルを置いて再起動してください。",
  "boot.error_dismiss": "閉じる",

  // capture indicator
  "capture.watching": "画面を見ています",

  // cue-list internal labels
  "cue.time_aria": "時刻",
  "cue.greeting_time_aria": "あいさつの時刻",
  "cue.minutes_word": "無操作",
  "cue.minutes_aria": "無操作の分数",
  "cue.minutes_suffix": "分ごと",
  "cue.toggle_aria": "{name} を有効化",
  "cue.toggle_fallback": "キュー",
  "cue.delete": "削除",
  "cue.confirm_q": "削除しますか？",
  "cue.confirm_go": "削除",
  "cue.confirm_cancel": "キャンセル",
  "cue.name_label": "名前",
  "cue.name_aria": "名前",
  "cue.ctx_label": "コンテキスト",
  "cue.ctx_aria": "AI が読み取るコンテキスト",
  "cue.ctx_placeholder": "AI に参考にしてほしい状況を自由に書いてね…",

  // panel chrome
  "panel.dialog_label": "設定",
  "panel.title": "設定",
  "panel.tablist_label": "設定エリア",
  "panel.drag_hint": "ドラッグで移動",
  "panel.pop_out": "ウィンドウに切り出す",
  "panel.close": "閉じる",
  "panel.rail_collapse": "セクション一覧を折りたたむ",
  "panel.rail_expand": "セクション一覧を広げる",
  "devtools.label": "開発者ツール",
  "devtools.sub": "送信コンテキストとモーションを確認",
  "devtools.open": "開く",
  "devtools.nav_aria": "開発者ツールのセクション",
  "devtools.nav.context": "コンテキストインスペクター",
  "devtools.nav.advanced": "詳細設定",
  "devtools.nav.motion": "モーションプレビュー",
  "devtools.loading_motion": "モーションプレビューを読み込み中…",
  "devtools.motion_load_failed":
    "モーションプレビューの読み込みに失敗しました。このタブを選び直すと再試行します。",
  "devtools.inspector.turns_aria": "最近のターン",
  "devtools.inspector.empty_title": "送信済みのコンテキストはまだありません",
  "devtools.inspector.empty_sub": "成功したターンがここに表示されます。",
  "devtools.advanced.limits": "上限",
  "devtools.advanced.context_window_label": "コンテキストウィンドウ（トークン）",
  "devtools.advanced.context_window_sub": "空欄の場合は同梱のエンドポイント設定を使用",
  "devtools.advanced.context_window_default": "デフォルト",

  // tabs
  "tabs.talk": "会話",
  "tabs.char": "キャラクター",
  "tabs.input": "入力",
  "tabs.adv": "詳細",
  "tabs.react": "リアクション",
  "tabs.hist": "履歴",

  // reasoning effort segment
  "reasoning.label": "推論の強さ",
  "reasoning.sub": "答える前にどれだけ深く考えるか",
  "reasoning.none": "なし",
  "reasoning.minimal": "最小",
  "reasoning.low": "低",
  "reasoning.medium": "中",

  // instructions
  "instructions.label": "指示",
  "instructions.sub": "空欄にするとデフォルトの指示を使います",
  "instructions.reset": "デフォルトに戻す",
  "instructions.placeholder_default": "デフォルトの指示を使用中",

  // filler (thinking interjections)
  "filler.section": "考え中のあいづち",
  "filler.enable_label": "あいづちを使う",
  "filler.enable_sub": "返事を待っている間に短いひと言を言います",
  "filler.lang_label": "言語",
  "filler.lang_sub": "あいづちを話す言語",
  "filler.lang_aria": "あいづちの言語",
  "filler.first_label": "最初のセリフ",
  "filler.first_sub": "ユーザーのメッセージが届くとすぐに一度再生",
  "filler.first_aria": "最初のセリフ一覧",
  "filler.repeat_label": "繰り返すセリフ",
  "filler.repeat_sub": "最初のセリフの後、応答が来るまで1秒ごとに再生",
  "filler.repeat_aria": "繰り返すセリフ一覧",
  "filler.hint": "両方の一覧を空にするとデフォルトの文言を使います。1行に1つずつ入力してください。",

  // language picker
  "language.label": "言語",
  "language.sub": "このアプリの表示言語",
  "language.aria": "表示言語",

  // VRM section
  "vrm.section": "VRM",
  "vrm.group_aria": "VRM",
  "vrm.add": "ファイルから追加…",
  "vrm.import_error": "このファイルは読み込めませんでした。VRM ファイルか確認してください。",
  "vrm.in_use": "使用中",
  "vrm.rename": "名前を変更",
  "vrm.remove": "削除",
  "vrm.name_aria": "VRM の名前",
  "vrm.import_overwrite_warn": "同じ名前の既存のモデルを上書きします",
  "vrm.rename_hint_save": "保存",
  "vrm.rename_hint_cancel": "キャンセル",
  "vrm.loading": "読み込み中…",
  "vrm.swapping": "切り替え中…",
  "vrm.swap_error": "このモデルを読み込めませんでした。前のモデルに戻しました。",

  // speaker section
  "speaker.section": "音声",
  "speaker.engine_label": "音声エンジン",
  "speaker.engine_sub": "キャラクターの声を作る合成エンジン",
  "speaker.engine_aria": "音声エンジン",
  "speaker.engine_irodori": "irodori",
  "speaker.engine_openai": "OpenAI 互換",
  "speaker.openai_hint":
    "irodori 専用です。OpenAI 互換エンジンはサーバーに設定された voice で話します。",
  "speaker.group_aria": "話者",
  "speaker.add": "ファイルから追加…",
  "speaker.import_error":
    "この音声を登録できませんでした。オーディオファイルと irodori サーバーを確認してください。",
  "speaker.in_use": "使用中",
  "speaker.rename": "名前を変更",
  "speaker.remove": "削除",
  "speaker.refresh": "参照音声を更新",
  "speaker.preview": "試聴",
  "speaker.name_aria": "話者の名前",
  "speaker.rename_hint_save": "保存",
  "speaker.rename_hint_cancel": "キャンセル",
  "speaker.import_overwrite_warn": "同じ名前の既存の音声を上書きします",
  "speaker.loading": "読み込み中…",
  "speaker.swapping": "切り替え中…",
  "speaker.refreshing": "更新中…",
  "speaker.swap_error": "この話者を読み込めませんでした。前の話者に戻しました。",
  "speaker.refresh_error": "参照音声を更新できませんでした。",
  "speaker.refresh_done": "参照音声を更新しました。",

  // expression (lipsync gain)
  "expression.section": "表現",
  "expression.mouth_label": "口の動き",
  "expression.mouth_sub": "声の大きさに合わせて口が開く度合い",
  "expression.mouth_aria": "口の動き",
  "expression.mouth_hint": "ドラッグするとキャラクターの口が実際にその分だけ開きます",

  // viewpoint (camera orbit)
  "viewpoint.section": "視点",
  "viewpoint.sub": "Shift + ドラッグで回転、スクロールでズーム",
  "viewpoint.reset": "正面に戻す",

  // screenshot / input tab
  "screenshot.label": "スクリーンショットを添付",
  "screenshot.sub": "会話しながら画面を一緒に見ます",
  "screenshot.source_label": "送る画面",
  "screenshot.source_aria": "送る画面",
  "screenshot.monitor_primary": "メイン画面",
  "screenshot.display": "ディスプレイ {n}",
  "screenshot.monitors_error": "画面の一覧を読み込めませんでした。",
  "screenshot.monitors_empty": "画面が見つかりませんでした。",
  "screenshot.foot_on": "オンの間は、すべてのメッセージにこの画面が添付されます。",
  "screenshot.foot_off": "初期設定はオフです。オンにすると画面も一緒に送ります。",

  // voice input
  "voice_input.label": "音声入力",
  "voice_input.sub": "話し終わると STT を実行し、ユーザー入力として送ります",
  "voice_input.aria": "音声入力",
  "voice_input.silence_label": "無音のしきい値",
  "voice_input.silence_sub": "話し終わってからこの時間だけ待ってから送信します",
  "voice_input.silence_aria": "無音のしきい値",
  "voice_input.bargein_label": "割り込み",
  "voice_input.bargein_aria": "割り込み（話すとキャラが止まる）",
  "bubble_persist.label": "閉じるまで吹き出しを表示",
  "bubble_persist.sub": "自分で閉じるまで吹き出しが消えません",
  "bubble_persist.aria": "閉じるまで吹き出しを表示",

  // history tab
  "history.current": "現在の会話",
  "history.turns": "{n}ターン",
  "history.who_user": "あなた",
  "history.who_yui": "ユイ",
  "history.empty": "まだ会話がありません",
  "history.foot": "直近200ターン · この端末にのみ保存",

  // TTS output toggle
  "tts_output.label": "音声出力",
  "tts_output.sub": "TTS で返答を読み上げます。オフにするとテキストのみ表示します",
  "tts_output.aria": "音声出力",

  // cue lists (input tab)
  "cue.schedule_title": "時間帯のあいさつ",
  "cue.schedule_sub": "決めた時刻に席にいると、先に話しかけます",
  "cue.schedule_add": "+ あいさつを追加",
  "cue.proactive_title": "ループリアクション",
  "cue.proactive_sub": "作業中にしばらく静かにしていると、定期的に先に話しかけます",
  "cue.proactive_add": "+ リアクションを追加",

  // endpoints
  "endpoints.section": "エンドポイント",
  "endpoints.summary_hint": "詳細 — サーバーアドレス・モデル",
  "endpoints.field_sub": "空欄にするとデフォルトを使います",
  "endpoints.reset": "デフォルトに戻す",
  "endpoints.url_error": "正しい URL ではありません (http:// または https://)",
  "endpoints.chat_base_url.label": "チャットサーバー URL",
  "endpoints.stt_base_url.label": "音声認識 (STT) サーバー URL",
  "endpoints.tts_base_url.label": "音声合成 (TTS) サーバー URL",
  "endpoints.irodori_base_url.label": "irodori サーバー URL",
  "endpoints.broker_base_url.label": "表現ブローカー URL",
  "endpoints.chat_model.label": "チャットモデル",

  "endpoints.tts_voice.label": "TTS voice",

  // per-service sections (advanced tab)
  "svc.type_label": "種類",
  "svc.chat": "チャット",
  "svc.chat_aria": "チャット API の種類",
  "svc.chat_type_responses": "Responses API",
  "svc.chat_type_completions": "Chat Completions",
  "svc.chat_preset_label": "プロバイダー",
  "svc.chat_preset_aria": "チャットプロバイダーのプリセット",
  "svc.chat_preset_custom": "カスタム",
  "svc.stt": "STT",
  "svc.stt_hint": "OpenAI 互換",
  "svc.stt_type": "OpenAI 互換",
  "svc.tts": "TTS",
  "svc.tts_aria": "TTS エンジン",
  "svc.broker": "Broker",
  "svc.broker_hint": "MCP streamable-http",
  "svc.broker_type": "MCP streamable-http",
  "svc.reset_chat": "チャットを戻す",
  "svc.reset_stt": "STT を戻す",
  "svc.reset_tts": "TTS を戻す",
  "svc.reset_broker": "Broker を戻す",

  // chat API key
  "chatkey.section": "チャット API キー",
  "chatkey.label": "チャット API キー",
  "chatkey.sub_default": "デフォルトを使用中 — 空欄にするとビルド時のキーを使います",
  "chatkey.sub_override": "この端末に保存済み — 空欄にすると元のキーに戻ります",
  "chatkey.show": "キーを表示",
  "chatkey.hide": "キーを隠す",
  "chatkey.clear": "キーを消去",

  // STT API key
  "sttkey.label": "STT API キー",
  "sttkey.sub_default": "デフォルトを使用中 — 空欄にするとビルド時のキーを使います",
  "sttkey.sub_override": "この端末に保存済み — 空欄にすると元のキーに戻ります",
  "sttkey.show": "キーを表示",
  "sttkey.hide": "キーを隠す",
  "sttkey.clear": "キーを消去",

  // TTS API key
  "ttskey.label": "TTS API キー",
  "ttskey.sub_default": "デフォルトを使用中 — 空欄にするとビルド時のキーを使います",
  "ttskey.sub_override": "この端末に保存済み — 空欄にすると元のキーに戻ります",
  "ttskey.show": "キーを表示",
  "ttskey.hide": "キーを隠す",
  "ttskey.clear": "キーを消去",

  // performance
  "perf.section": "パフォーマンス",
  "perf.idle_label": "待機中の省電力 (30fps)",
  "perf.idle_sub":
    "キャラクターが静止しているときにフレームレートを下げて電力を節約します。話したり動いたりすると自動でなめらかに戻ります。",
  "perf.idle_aria": "待機中の省電力",
  "gaze.label": "カーソルを追う",
  "gaze.sub": "キャラクターがマウスカーソルの動きに合わせて目と頭を向けます。",
  "gaze.aria": "カーソルを追う",
  "agentNotify.label": "エージェント通知",
  "agentNotify.sub":
    "Claude Code や opencode などのコーディングエージェントがタスクを終えたとき、または入力が必要なときに先に知らせます。",
  "agentNotify.aria": "エージェント通知",

  // first-run onboarding hint
  "hint.first_run": "右クリックでコントロール · {hotkey}で話しかけてね",
  "hint.first_run_no_hotkey": "右クリックでコントロール",
  "hint.setup_backend":
    "考えるためのバックエンドがまだないの · 右クリックして詳細タブを開いて、OpenAI 互換サーバーを指定してね",

  // reactions tab
  "reactions.watchers_title": "ウォッチャー",
  "reactions.shared_title": "共通",
  "reactions.port_label": "リスナーポート",
  "reactions.port_sub": "完了フックサーバーが待ち受けるポート",
  "reactions.presence_label": "在席とみなす無操作時間",
  "reactions.presence_sub": "この時間以内の無操作であれば在席とみなします",
  "reactions.seconds_suffix": "秒",
  "reactions.restart_hint": "変更を適用するにはアプリを再起動してください",

  // workflows
  "workflows.title": "ワークフロー",
  "workflows.sub": "保存したエンドポイントをすぐに実行します。▶ の初回実行で接続も確認できます。",
  "workflows.label_label": "名前",
  "workflows.label_ph": "例: 朝のダイジェスト",
  "workflows.url_label": "URL",
  "workflows.url_ph": "https://…",
  "workflows.url_error": "正しい URL を入力してください。例: https://example.com/hook",
  "workflows.add": "追加",
  "workflows.empty": "ワークフローはまだありません。下から追加してください。",
  "workflows.fire_aria": "{name} を実行",
  "workflows.delete_aria": "{name} を削除",

  // session
  "session.section": "セッション",
  "session.context": "コンテキスト",
  "session.action_label": "新しい会話を始める",
  "session.action_sub": "新しい会話を始めます。これまでの会話は上の履歴にそのまま残ります。",
  "session.reset": "会話をリセット",
  "session.confirm_q": "やり直しますか？",
  "session.confirm_go": "新しく始める",
  "session.confirm_cancel": "キャンセル",
};

export default ja;
