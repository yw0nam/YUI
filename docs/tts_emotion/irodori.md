# `emotion_text` rule — irodori (default)

| | |
|---|---|
| provider | `irodori` (default) |
| `tts_provider` | `"irodori"` |
| broker mode | `enum` |
| table | the 39-row emoji table below |

Emoji are inserted **inline** into the spoken text (prefixed onto the TTS
segment). **Repeat an emoji to intensify** (e.g. `🥺` → `🥺🥺`); combinations are
allowed. YUI publishes this exact table to the broker via
`update_emotion_text("enum", <table>)`, and the broker enum-gates incoming
`emotion_text` against it (unknown tokens dropped + warning, speech never
blocked). The canonical machine copy lives under `configs/`
([D3](../expression-broker-mcp.md)).

This table stays aligned with the broker's 39-entry `DEFAULT_EMOTION_TEXT_MAP`.

## Emoji table

| Emoji | 日本語の意味 | Meaning / Emotion / Style |
|---|---|---|
| 👂 | 囁き、耳元の音 | Whisper, sounds close to the ear |
| 😮‍💨 | 吐息、溜息、寝息 | Breath, sigh, sleeping breath |
| ⏸️ | 間、沈黙 | Pause, silence |
| 🤭 | 笑い（くすくす、含み笑いなど） | Chuckle, giggle, suppressed laugh |
| 🥵 | 喘ぎ、うめき声、唸り声 | Panting, moan, groan |
| 📢 | エコー、リバーブ | Echo, reverb |
| 😏 | からかうように、甘えるように | Teasing, playfully sweet / coaxing |
| 🥺 | 声を震わせながら、自信のなさげに | Trembling voice, timidly / uncertainly |
| 🌬️ | 息切れ、荒い息遣い、呼吸音 | Shortness of breath, heavy breathing |
| 😮 | 息をのむ | Gasp |
| 👅 | 舐める音、咀嚼音、水音 | Licking sound, chewing sound, wet sound |
| 💋 | リップノイズ | Lip smack / lip noise |
| 🫶 | 優しく | Gently, tenderly |
| 😭 | 嗚咽、泣き声、悲しみ | Sobbing, crying, sorrowfully / sadly |
| 😱 | 悲鳴、叫び、絶叫 | Scream, shout, shriek |
| 😪 | 眠そうに、気だるげに | Sleepily, sluggishly / languidly |
| ⏩ | 早口、一気にまくしたてる、急いで | Fast-speaking, rapid-fire, hurriedly |
| 📞 | 電話越し、スピーカー越しのような音 | Over the phone, through a speaker |
| 🐢 | ゆっくりと | Slowly |
| 🥤 | 唾を飲み込む音 | Gulp, swallowing sound |
| 🤧 | 咳き込み、鼻をすする、くしゃみ、咳払い | Coughing, sniffling, sneeze, clearing throat |
| 😒 | 舌打ち | Tutting, clicking tongue |
| 😰 | 慌てて、動揺、緊張、どもり | Panicked, agitated, nervous, stuttering |
| 😆 | 喜びながら | Joyfully, happily |
| 😠 | 怒り、不満げに、拗ねながら | Angry, displeased, sulking |
| 😲 | 驚き、感嘆 | Surprise, awe / exclamation |
| 🥱 | あくび | Yawn |
| 😖 | 苦しげに | Painfully, agonizingly |
| 😟 | 心配そうに | Anxiously, worriedly |
| 🫣 | 恥ずかしそうに、照れながら | Shyly, bashfully |
| 🙄 | 呆れたように | Exasperatedly, rolling eyes |
| 😊 | 楽しげに、嬉しそうに | Cheerfully, gladly |
| 👌 | 相槌、頷く音 | Backchanneling, sound of agreement |
| 🙏 | 懇願するように | Pleadingly, begging |
| 🥴 | 酔っ払って | Drunkenly |
| 🎵 | 鼻歌 | Humming |
| 🤐 | 口を塞がれて | Muffled (mouth covered) |
| 😌 | 安堵、満足げに | Relieved, contentedly |
| 🤔 | 疑問の声 | Questioning voice, wondering |

## Usage examples

- Whisper: `👂 Can you hear me?`
- Intensify by repetition: `😆😆 I can't believe you said that!`
