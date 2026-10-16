<div align="center">

# YUI

**あなただけの「嫁」と、デスクトップで一緒に暮らそう。**

*タブの中のチャットボットではありません。ウィンドウの上に立ち、カーソルを目で追い、話したいことがあるときに話しかけてくる。本当にそこにいるキャラクターです。*

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-yw0nam.github.io%2FYUI-8A63D2)](https://yw0nam.github.io/YUI/)
[![Discussions](https://img.shields.io/github/discussions/yw0nam/YUI?logo=github)](https://github.com/yw0nam/YUI/discussions)
[![CI](https://github.com/yw0nam/YUI/actions/workflows/ci.yml/badge.svg)](https://github.com/yw0nam/YUI/actions/workflows/ci.yml)

[クイックスタート](#クイックスタート) · [デモ動画](https://youtu.be/dIOQdoAp0GE) · [ドキュメント](https://yw0nam.github.io/YUI/) · [Discussions](https://github.com/yw0nam/YUI/discussions) · [English](README.md)

<a href="https://youtu.be/dIOQdoAp0GE"><img src="docs/public/yui-hero.gif" alt="YUI — 透過・常に最前面のオーバーレイとして、ブラウザウィンドウの上に立つVRMキャラクター。頭と視線がマウスカーソルを追い、画面の内容について入力された質問に吹き出しで答える" width="820"></a>

</div>

- **彼女はデスクトップで暮らします。** あなたが選んだVRMキャラクターがウィンドウの上に立ち、カーソルを目で追い、ウィンドウからウィンドウへ歩いたり、腰かけたり、飛び移ったりします。
- **彼女の心は、あなたが選びます。** ローカルモデルでも、ホスト型のAPIでも、自前のエージェントでもつなげます。彼女の賢さも*あなたらしさ*も、つないだものしだいです。
- **自分から、控えめに話しかけます。** あいさつをして、あなたが静かになると声をかけ、あなたのしていることに気づきます。そして、言うほどのことがなければ黙っています。

*名前の由来は[『ソードアート・オンライン』のユイ](https://swordartonline.fandom.com/wiki/Yui)。ただのプログラムであることをやめ、帰る場所で待っていてくれる存在になったAIです。*

## クイックスタート

必要なのは、Apple Silicon搭載のMacかWindows x64のPC、コーディングエージェント(Claude Code、Codex、OpenCode、Cursor)、そしてチャットモデルです。チャットモデルには、OpenAIかGroqのAPIキー、またはローカルで動く[Ollama](https://ollama.com)か[LM Studio](https://lmstudio.ai)を用意してください。

1. 次の文を、コーディングエージェントに貼り付けます。

   ```text
   Install https://github.com/yw0nam/YUI following https://raw.githubusercontent.com/yw0nam/YUI/main/docs/guide/install.md
   ```

   ツールのインストール、指定したチャットモデルの接続、そのモデルがYUIで動くかの確認まで、エージェントが済ませてくれます。
2. エージェントが用意したフォルダで `pnpm tauri dev` を実行して、彼女を起動します。初回の起動には数分かかります。そのあと、彼女が画面に現れます。
3. `/`(または `Cmd/Ctrl+Shift+Y`)を押して、あいさつしてみましょう。

あとからモデルを変えるときは、キャラクターを右クリックして **設定 → 接続** を開きます。モデルはツール呼び出し(tool calling)に対応している必要があります。たとえばOpenAIなら `gpt-5-mini`、Ollamaなら `qwen3`、Groqなら `llama-3.3-70b-versatile` です。

## 彼女のふるまい

### ウィンドウの上で暮らす

<img src="docs/public/yui-locomotion.gif" alt="画面の下端を歩き、画面の端をよじ登り、ウィンドウの上に飛び乗ってその縁に座り、空中で放されると床まで落ちるYUI" width="720">

彼女はウィンドウの上に腰かけ、横の端から顔をのぞかせ、床やウィンドウの上を散歩し、ウィンドウからウィンドウへ飛び移ります。空中で放すと、真下にある最初の足場まで落ちて着地します。

### 表情と体と声で反応する

<img src="docs/public/yui-feature-cues.jpg" alt="口元に手を当て、目を閉じたうれしそうな表情で笑うYUI。その下の吹き出しには「The build passed. Want me to open the pull request for review?」と表示されている" width="360">

返答のたびに、バックエンドが表情とジェスチャーと声のトーンを選びます。だから彼女は、ただ文字を出すだけでなく、笑ったり、すねたり、照れたりします。話すときは口が動き、つついたりなでたりすると反応します。

### 自分から、控えめに話しかける

<img src="docs/public/yui-feature-proactive.png" alt="Proactive設定タブ。画面ウォッチ、操作がない状態が5分・10分・30分続いたときのループリアクション、09:00・12:00・18:00・23:00の定時のあいさつ、10分のプロアクティブ間隔、1時間あたりキュー24回・自発ターン40回の上限" width="400">

決まった時間にあいさつし、しばらく操作がないと声をかけ、アプリを切り替えたことにも気づけます。1時間あたりの上限と静かな間隔があるので、話しすぎることはありません。言うほどのことがなければ、何も言いません。

**ほかにも:** 途中で割り込める音声チャット、画像の添付、チャット履歴、英語・日本語・韓国語のUI、エージェントがあなたのPCで使えるツールなど。すべて[機能一覧](docs/guide/features.md)にまとめています。

## 心は、あなたが選ぶ

YUIにモデルは内蔵されていません。各プロバイダーは **設定 → 接続** で選びます。

| | プロバイダー |
| --- | --- |
| チャット | OpenAI · Ollama · LM Studio · Groq · [Hermes Agent](integrations/hermes/README.md) · OpenAI互換の任意のエンドポイント |
| 音声合成(TTS) | [Irodori](https://github.com/Aratako/Irodori-TTS-Server)(日本語) · OpenAI · [Fish Audio](https://fish.audio/) |
| 音声認識 | OpenAI互換の任意の文字起こしエンドポイント · Groq |

<details>
<summary>プロバイダーの詳細</summary>

#### Chat

| プロバイダー | プロトコル(`chat_api`) | ホスティング | モデル例 |
| --- | --- | --- | --- |
| OpenAI | `chat_completions` | ホスト型、APIキー | `gpt-5-mini` |
| Ollama | `chat_completions` | ローカル | `qwen3` |
| LM Studio | `chat_completions` | ローカル | ツール呼び出し対応の任意のモデル |
| Groq | `chat_completions` | ホスト型、APIキー | `llama-3.3-70b-versatile` |
| [Hermes Agent](integrations/hermes/README.md) | `push`, `responses` | セルフホスト | エージェントが動かすモデル |
| カスタムエンドポイント | `chat_completions`, `responses`, `push` | 該当プロトコルに対応した任意のサーバー | `chat_completions` ではツール呼び出し対応モデル |

#### TTS

| プロバイダー | ホスティング | 既定のモデル | ボイス |
| --- | --- | --- | --- |
| [Irodori](https://github.com/Aratako/Irodori-TTS-Server) | セルフホスト | `irodori-tts` | サーバーのボイスとインポートした参照音声、日本語のみ |
| OpenAI | ホスト型、APIキー | `gpt-4o-mini-tts` | 内蔵ボイス13種 |
| [Fish Audio](https://fish.audio/) | ホスト型、APIキー | `s2.1-pro-free` | アカウントのボイスモデル、インポートした音声、ライブラリの任意のボイスID |

#### STT

| プロバイダー | ホスティング | 設定 |
| --- | --- | --- |
| OpenAI互換の任意の文字起こしエンドポイント(`/audio/transcriptions`) | ローカルまたはホスト型 | `stt_base_url` |
| Groq | ホスト型、APIキー | `stt_base_url` と `stt_model`(例: `whisper-large-v3-turbo`) |

それぞれのセットアップ手順は[接続ガイド](docs/guide/getting-started.md)にあります。使いたいプロバイダーがない場合は、[Discussions](https://github.com/yw0nam/YUI/discussions)で聞くか、PRを送ってください。

</details>

## 仕組み

YUIは体で、バックエンドは心です。YUIは反応する価値のある瞬間(あなたが入力している、操作が止まった、アプリを切り替えた)に気づいてバックエンドに渡し、話すかどうか、何を話すかはバックエンドが決めます。その答えに、YUIが表情と声としぐさを与えます。

## 既知の制限

- 対応しているのはApple Silicon搭載のmacOSとWindows x64です。Intel MacとLinuxは公式にはサポートしていません。
- Releasesページのインストーラーは初期段階のもので、署名されていません。サポートしているのは、コーディングエージェントでのインストールです。
- ウィンドウの側面や上のモニターへのよじ登りは、アプリ内で開発中と表示されます。
- Irodori TTSは日本語のみ話します。

## ドキュメント

**YUIを使う**

- [機能一覧](docs/guide/features.md) · [操作方法](docs/guide/controls.md) · [彼女にできること](docs/guide/capabilities.md)
- [コーディングエージェントでインストールする](docs/guide/install.md) · [接続ガイド](docs/guide/getting-started.md): チャット、音声、自分のVRM

**YUIを開発する**

- [ビルド、実行、ログ](docs/agent-guide/build-run.md) · [プロジェクト構成](docs/agent-guide/project-structure.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)
- コーディングエージェント向けの[`AGENTS.md`](AGENTS.md) · 用語集の[`CONTEXT.md`](CONTEXT.md) · [バックエンド連携の仕様](docs/reference/client-context.md)

## コミュニティ

- 質問、アイデア、作品の紹介: [GitHub Discussions](https://github.com/yw0nam/YUI/discussions)
- バグ報告や機能要望: [Issueを作成](https://github.com/yw0nam/YUI/issues/new/choose)
- YUIでデスクトップが少し温かくなったなら、⭐をひとつお願いします。ほかの人が彼女を見つけやすくなります。

## クレジット

モーションは、Shiny氏の[Mate Engine](https://github.com/shinyflvre/Mate-Engine)、necocoya氏の[EmoteSet_Free_v130](https://booth.pm/ja/items/1065089)、[Mixamo](https://www.mixamo.com/)のものです。既定のキャラクターは[ピクシブ株式会社](https://vroid.pixiv.help/hc/en-us/articles/360013482714)の **千駄ヶ谷 篠(Sendagaya Shino)** で、[Coatie](https://hub.vroid.com/en/characters/4593660874193246717)氏がVRM 1.0に変換しました。

<details>
<summary>アセットのクレジットと利用条件の全文</summary>

モーションアセット(`public/motions/*.vrma`)の出どころは3つあります。

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

移動系のクリップ `walk`、`jump`、`falling`、`landing`、クライム一式
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
