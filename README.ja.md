<div align="center">

# YUI

**あなただけの「嫁」と、デスクトップで一緒に暮らそう。**

*画面の中のチャットボットではなく、デスクトップに「いる」キャラクター。ウィンドウの上に立ち、カーソルを目で追い、話したいことがあれば自分からそっと声をかけてくれます。*

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-yw0nam.github.io%2FYUI-8A63D2)](https://yw0nam.github.io/YUI/)
[![Discussions](https://img.shields.io/github/discussions/yw0nam/YUI?logo=github)](https://github.com/yw0nam/YUI/discussions)
[![CI](https://github.com/yw0nam/YUI/actions/workflows/ci.yml/badge.svg)](https://github.com/yw0nam/YUI/actions/workflows/ci.yml)

[クイックスタート](#クイックスタート) · [デモ動画](https://youtu.be/dIOQdoAp0GE) · [ドキュメント](https://yw0nam.github.io/YUI/) · [Discussions](https://github.com/yw0nam/YUI/discussions) · [English](README.md)

<a href="https://youtu.be/dIOQdoAp0GE"><img src="docs/public/yui-hero.gif" alt="YUI — 透過・常に最前面のオーバーレイとして、ブラウザウィンドウの上に立つVRMキャラクター。頭と視線がマウスカーソルを追い、画面の内容について入力された質問に吹き出しで答える" width="820"></a>

</div>

- **デスクトップで暮らす** — お気に入りのVRMキャラクターがウィンドウの上に立ち、カーソルを目で追いかけます。ウィンドウの上を歩いたり、縁にちょこんと腰かけたり、別のウィンドウへ飛び移ったりも。
- **「頭脳」は自由に選べる** — ローカルモデル、クラウドのAPI、自作のエージェントまで。彼女のペルソナはアプリで書いても、エージェントが持ってきてもかまいません。何を話すかを決めるのは頭脳です。
- **自分から話しかける。でも、控えめに** — あいさつやちょっとした声かけは自分から。話すことがないときは、静かに見守ってくれます。

*名前の由来は[『ソードアート・オンライン』のユイ](https://swordartonline.fandom.com/wiki/Yui)。ただのプログラムから、「おかえり」と迎えてくれる存在になったAIです。*

## クイックスタート

用意するもの:

- Apple Silicon搭載のMac、またはWindows x64のPC
- コーディングエージェント(Claude Code、Codex、OpenCode、Cursorなど)
- 彼女と話すためのチャットモデル(OpenAIかGroqのAPIキー、またはローカルで動く[Ollama](https://ollama.com)か[LM Studio](https://lmstudio.ai))。インストールのときに接続しても、あとからでもかまいません

1. 下の一文をコーディングエージェントに貼り付けます。

   ```text
   Install https://github.com/yw0nam/YUI following https://raw.githubusercontent.com/yw0nam/YUI/main/docs/guide/install.md
   ```

   必要なツールの導入からチャットモデルの接続、動作確認まで、エージェントが進めてくれます。APIキーなど、エージェントにわからないことだけ聞かれます。
2. エージェントに起動を頼んでください。自分で起動する場合は、ターミナルでYUIのフォルダを開いて `pnpm tauri dev` を実行します。初回は数分かかり、そのあと画面にキャラクターが現れます。
3. `/`(または `Cmd/Ctrl+Shift+Y`)を押して、話しかけてみてください。

声で話すには、**設定 → 接続** で音声認識と音声合成を設定し、**設定 → 声** で声(話者)を選んでください(キャラクターを右クリックして **すべての設定…** を選ぶと設定が開きます)。チャットモデルの変更は接続の画面でできます。OpenAI、Ollama、LM Studio、GroqはChat Completions方式で接続するため、ツール呼び出し(tool calling)に対応したモデルが必要です。たとえばOpenAIなら `gpt-5-mini`、Ollamaなら `qwen3`、Groqなら `llama-3.3-70b-versatile` が使えます。

## できること

### ウィンドウの上で暮らす

<img src="docs/public/yui-locomotion.gif" alt="画面の下端を歩き、画面の端をよじ登り、ウィンドウの上に飛び乗ってその縁に座り、空中で放されると床まで落ちるYUI" width="720">

ウィンドウの上に腰かけたり、端からひょっこり顔をのぞかせたり。床やウィンドウの上を散歩して、ウィンドウからウィンドウへ飛び移ります。空中で手を離すと、下にあるウィンドウや画面の下端まで落ちて着地します。

### 表情・しぐさ・声で反応する

<img src="docs/public/yui-feature-cues.jpg" alt="口元に手を当て、目を閉じたうれしそうな表情で笑うYUI。その下の吹き出しには「The build passed. Want me to open the pull request for review?」と表示されている" width="360">

つないだAIが、返事に合わせて表情やしぐさ、声の調子を選びます。文字を返すだけでなく、笑ったり、すねたり、照れたり。しゃべると口が動き、つついたりなでたりすると反応します。

### 自分から、控えめに話しかける

<img src="docs/public/yui-feature-proactive.png" alt="Proactive設定タブ。画面ウォッチ、操作がない状態が5分・10分・30分続いたときの反応、09:00・12:00・18:00・23:00の定時のあいさつ、自分から話しかける間隔10分、1時間あたりキュー24回・自発ターン40回の上限" width="400">

決まった時間のあいさつ、しばらく手が止まったときの声かけ、オンにすればアプリを切り替えたときの反応も。自分から話しかける回数や間隔は設定で調整できます。話すことがなければ、静かに見守ってくれます。

### ブラウザで調べものをしてくれる

<a href="https://youtu.be/XB-jRXspJ_E"><img src="docs/public/yui-scenario-browse.gif" alt="チャットウィンドウでユーザーがYangyangにyw0nam/YUIの検索を頼むと、ego liteで開いたGoogle検索結果が彼女の横に表示され、GitHubのプロジェクトが見つかったと彼女が答える" width="560"></a>

[プラグインページ](docs/guide/plugins.md)で公式の `browser` プラグインをインストールして有効にすると、[ego lite](plugins/browser/README.md)でWebを検索し、ページを開いて、見つけたことを教えてくれます。対応ブラウザはego liteのみです。

### 何人ものキャラクターを、ひとつの会話で

キャラクターはそれぞれ、頭脳、ペルソナ、声、VRMモデル、履歴を自分だけのものとして持ち、デスクトップには4人まで一緒に置けます。会話はひとつのウィンドウにまとまり、一度にひとりのセリフだけが表示されます。話す相手はひとりでも全員でも選べて `@名前` でも指定でき、声で話しかけたときも同じ相手に届きます。キャラクターどうしでメッセージを渡すこともできます。

<a href="https://youtu.be/m8myp8pT4Yw"><img src="docs/public/yui-scenario-together.gif" alt="ブラウザのページの横に立つYangyangとSuisui。ユーザーがふたりにそれぞれ自分のことを調べるよう頼み、ふたりがチャットウィンドウで順番に答える" width="400"></a> <a href="https://youtu.be/LQpZq9HcIuk"><img src="docs/public/yui-scenario-address.gif" alt="チャットウィンドウで、Yangyangがユーザーの質問をSuisuiに渡し、Suisuiが彼女に答える" width="400"></a>

### コーディングエージェントのスレッドを読む

[Claude CodeとCodex向けのyui-notify](plugins/yui-notify/README.md)は、会話をスレッドとして届けます。キャラクターは発話しません。Codexでは同期フックを通じて許可や次の指示を返せます。Claude Codeでは、起動フラグなしで、セッションのinboxソケットを通じて返答が届きます。**設定 → 話しかけ → ウォッチャー** で **外部シグナル** をオンにして、YUIを再起動してください。

**ほかにも:** 自分のVRMモデル、Tavernカードのインポートと書き出し、話の途中でも声で割り込める音声会話、画像の添付、会話履歴、キャラクターがあなたやほかのキャラクターに抱く気持ち、右クリックで開くクイックカード、DawnとHearthのテーマ、日本語・英語・韓国語のUI、エージェントがPC上で使えるツールなど。詳しくは[機能一覧](docs/guide/features.md)をご覧ください。

## 仕組み

YUIは「体」、つないだモデルやエージェントが「頭脳」です。メッセージを送ったとき、しばらく操作しなかったとき、アプリを切り替えたとき——そんな出来事をYUIが拾って、つないだAIに伝えます。話すかどうか、何を話すかを決めるのはAIのほうです。その返事に、YUIが表情と声としぐさをつけます。

## 「頭脳」をつなぐ

YUI自体はモデルを内蔵していません。何ができるかで頭脳を選んでください。

| 頭脳 | 得られるもの |
| --- | --- |
| **OpenAI互換の任意のエンドポイント**(OpenAI · Ollama · LM Studio · Groq · 自前のエンドポイント) | チャット、アプリで書くペルソナ、ツール呼び出し対応モデルでの表情。音声と音声認識は別の接続です。 |
| **記憶を持つオートメーションエージェントとプッシュトランスポート** | バックエンドが自分から始めるターン、エージェントが保持する長期記憶、バックエンドが報告したときの委任ステータス。フル機能にはこちらがおすすめです。実例: [Hermes Agent](integrations/hermes/README.md)。ほかのエージェントは[プッシュ契約](docs/reference/push-transport.md)で接続します。 |

プロバイダーは **設定 → 接続** で選びます。

| | プロバイダー |
| --- | --- |
| チャット | OpenAI · Ollama · LM Studio · Groq · [Hermes Agent](integrations/hermes/README.md) · OpenAI互換のエンドポイント |
| 音声合成(TTS) | [Irodori](https://github.com/Aratako/Irodori-TTS-Server)(日本語) · OpenAI · [Fish Audio](https://fish.audio/) |
| 音声認識(STT) | OpenAI互換の文字起こしエンドポイント · Groq |

<details>
<summary>プロバイダーの詳細</summary>

#### チャット

| プロバイダー | プロトコル(`chat_api`) | 実行環境 | モデル例 |
| --- | --- | --- | --- |
| OpenAI | `chat_completions` | クラウド(APIキー) | `gpt-5-mini` |
| Ollama | `chat_completions` | ローカル | `qwen3` |
| LM Studio | `chat_completions` | ローカル | ツール呼び出し対応の任意のモデル |
| Groq | `chat_completions` | クラウド(APIキー) | `llama-3.3-70b-versatile` |
| [Hermes Agent](integrations/hermes/README.md) | `push`, `responses` | セルフホスト | エージェント側で使用するモデル |
| カスタムエンドポイント | `chat_completions`, `responses`, `push` | 該当プロトコルに対応した任意のサーバー | `chat_completions` ではツール呼び出し対応モデル |

#### TTS

| プロバイダー | 実行環境 | 既定のモデル | ボイス |
| --- | --- | --- | --- |
| [Irodori](https://github.com/Aratako/Irodori-TTS-Server) | セルフホスト | `irodori-tts` | サーバーのボイスとインポートした参照音声、日本語のみ |
| OpenAI | クラウド(APIキー) | `gpt-4o-mini-tts` | 内蔵ボイス13種 |
| [Fish Audio](https://fish.audio/) | クラウド(APIキー) | `s2.1-pro-free` | アカウントのボイスモデル、インポートした音声、ライブラリの任意のボイスID |

#### STT

| プロバイダー | 実行環境 | 設定 |
| --- | --- | --- |
| OpenAI互換の任意の文字起こしエンドポイント(`/audio/transcriptions`) | ローカルまたはクラウド | `stt_base_url` |
| Groq | クラウド(APIキー) | `stt_base_url` と `stt_model`(例: `whisper-large-v3-turbo`) |

それぞれのセットアップ手順は[接続ガイド](docs/guide/connect-a-backend.md)にあります。使いたいプロバイダーが見当たらなければ、[Discussions](https://github.com/yw0nam/YUI/discussions)で気軽に相談するか、PRを送ってください。

</details>

## 既知の制限

- 対応環境はApple Silicon搭載のmacOSとWindows x64です。Intel MacとLinuxは公式サポート外です。
- [インストール](docs/guide/installation.md)に、コーディングエージェント経由とReleasesページのインストーラーの両方の手順があります。macOS版はアドホック署名なので、初回起動時にシステム設定 → プライバシーとセキュリティ → このまま開くを選んでください。
- ウィンドウの側面や上のモニターへのよじ登りは、アプリ内で「開発中」と表示されます。
- Irodori TTSは日本語専用です。

## ドキュメント

**はじめる**

- [インストール](docs/guide/installation.md) · [コーディングエージェントでインストール](docs/guide/install.md) · [バックエンドをつなぐ](docs/guide/connect-a-backend.md) · [音声の入力と出力](docs/guide/voice.md)

**使う**

- [YUIと一緒にできること](docs/guide/capabilities.md) · [機能一覧](docs/guide/features.md) · [操作方法](docs/guide/controls.md) · [設定](docs/guide/settings.md) · [カード](docs/guide/cards.md) · [プラグイン](docs/guide/plugins.md)

**拡張する**

- [プラグインを書く](docs/guide/write-a-plugin.md) · [プラグインを公開する](docs/guide/contribute-a-plugin.md) · [プロデューサーからシグナルを送る](docs/guide/signals-producer.md) · [モーション](docs/guide/motions.md) · [TTS感情](docs/guide/tts-emotion/)

**開発する人向け**

- [ビルド・実行・ログ](docs/agent-guide/build-run.md) · [プロジェクト構成](docs/agent-guide/project-structure.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`AGENTS.md`](AGENTS.md)(コーディングエージェント向け) · [`GLOSSARY.md`](GLOSSARY.md)(用語集) · [バックエンド連携の仕様](docs/reference/client-context.md)

## コミュニティ

- 質問・アイデア・作品の共有: [GitHub Discussions](https://github.com/yw0nam/YUI/discussions)
- バグ報告・機能要望: [Issueを作成](https://github.com/yw0nam/YUI/issues/new/choose)
- 気に入ったら、⭐で応援してもらえるとうれしいです。ほかの人がYUIを見つけるきっかけになります。

## クレジット

モーションはShiny氏の[Mate Engine](https://github.com/shinyflvre/Mate-Engine)、necocoya氏の[EmoteSet_Free_v130](https://booth.pm/ja/items/1065089)、[Mixamo](https://www.mixamo.com/)、そしてYUIのためにAIで作ったクリップのものを使っています。既定のキャラクターは[ピクシブ株式会社](https://vroid.pixiv.help/hc/en-us/articles/360013482714)の **千駄ヶ谷 篠(Sendagaya Shino)** を、[Coatie](https://hub.vroid.com/en/characters/4593660874193246717)氏がVRM 1.0に変換したものです。

デモ動画とGIFでは、YUIに含まれていない別のVRMモデルと音声を使っています。自分のVRMを読み込んで使えます。

<details>
<summary>アセットのクレジットと利用条件の全文</summary>

モーションアセット(`public/motions/*.vrma`)は、次の3つの提供元のものを使っています。

大半のクリップは、Shiny氏の
[Mate Engine](https://github.com/shinyflvre/Mate-Engine)プロジェクトから抽出した
もので、Mate Engineの非商用条件のもとで使用しています。Shiny氏のクレジットを
表記すれば、個人利用、学習目的、収益を伴わない利用は無料です。商用利用には
Shiny氏から別途許可を得る必要があります。

`sulk` クリップ(`suneru.vrma`)は、necocoya氏の
[EmoteSet_Free_v130](https://booth.pm/ja/items/1065089)(Unity Humanoid
`06_suneru`、「拗ね」)に含まれるもので、necocoya氏のクレジットを表記しています。
改変、変換、クレジットを表記したうえでの同梱は許可されています。元ファイル単体での
再販売は禁止されています。

移動系のクリップ `walk`、`jump`、`falling`、`landing`、よじ登る・降りる動作のモーション一式
(`climb_up`、`climb_up_done`、`climb_down`、`climb_down_landing`)、`sit_down`、
`stand_up` は[Mixamo](https://www.mixamo.com/)のもので、Mixamoの規約に基づき
ロイヤリティフリーです。

同梱している既定のVRMモデル
(`resources/vrms/Sendagaya_Shino.vrm`)は **千駄ヶ谷 篠(Sendagaya Shino)** です。原作は
[ピクシブ株式会社](https://vroid.pixiv.help/hc/en-us/articles/360013482714)(VRoid
プロジェクト、CC0)で、
[Coatie](https://hub.vroid.com/en/characters/4593660874193246717)氏がVRM 1.0に
変換しました。どちらのライセンスもクレジット表記を求めていません。表記の全文は
[`resources/vrms/Sendagaya_Shino.PROVENANCE.md`](resources/vrms/Sendagaya_Shino.PROVENANCE.md)
をご覧ください。

</details>

## ライセンス

YUIはソースアベイラブルです。ソースコードは
[PolyForm Noncommercial License 1.0.0](LICENSE)のもとでライセンスされており、
クレジットを表記すれば、非商用での利用、改変、再配布は無料です。**商用利用には
作者の許可が必要です**([https://github.com/yw0nam](https://github.com/yw0nam))。

同梱のモーションアセット(`public/motions/*.vrma`)は、このライセンスの対象には**含まれません**。
それぞれ原作者の条件に従います。上の[クレジット](#クレジット)をご覧ください。
