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
  "input.placeholder": "話しかけてみて…",

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

  // tabs
  "tabs.talk": "会話",
  "tabs.char": "キャラクター",
  "tabs.input": "入力",
  "tabs.adv": "詳細",

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
  "screenshot.foot_on": "オンの間は、すべてのメッセージにこの画面が添付されます。",
  "screenshot.foot_off": "初期設定はオフです。オンにすると画面も一緒に送ります。",

  // voice input
  "voice_input.label": "音声入力",
  "voice_input.sub": "話し終わると STT を実行し、ユーザー入力として送ります",
  "voice_input.aria": "音声入力",
  "voice_input.silence_label": "無音のしきい値",
  "voice_input.silence_sub": "話し終わってからこの時間だけ待ってから送信します",
  "voice_input.silence_aria": "無音のしきい値",

  // TTS output toggle
  "tts_output.label": "音声出力",
  "tts_output.sub": "TTS で返答を読み上げます。オフにするとテキストのみ表示します",
  "tts_output.aria": "音声出力",

  // cue lists (input tab)
  "cue.schedule_title": "時間帯のあいさつ",
  "cue.schedule_sub": "決めた時刻に席にいると、先に話しかけます",
  "cue.schedule_add": "+ あいさつを追加",
  "cue.proactive_title": "自発的なリアクション",
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
  "svc.chat_hint": "Responses API",
  "svc.chat_type": "Responses API",
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
  "gaze.label": "カメラを見る",
  "gaze.sub": "キャラクターが目と頭をカメラの視点に向けて視線を合わせます。",
  "gaze.aria": "カメラを見る",
  "github.label": "GitHub PR を見張る",
  "github.sub": "オープンな PR を定期的に確認し、CI が壊れたりレビューが届いたら先に知らせます。",
  "github.aria": "GitHub PR を見張る",
  "agentNotify.label": "エージェント完了通知",
  "agentNotify.sub":
    "Claude Code や opencode などのコーディングエージェントがタスクを終えたら先に知らせます。",
  "agentNotify.aria": "エージェント完了通知",

  // session
  "session.section": "セッション",
  "session.context": "コンテキスト",
  "session.action_label": "新しい会話を始める",
  "session.action_sub": "新しい会話を始めます。始めるまで YUI は今の記憶を保ったままです。",
  "session.reset": "会話をリセット",
  "session.confirm_q": "やり直しますか？",
  "session.confirm_go": "新しく始める",
  "session.confirm_cancel": "キャンセル",
};

export default ja;
