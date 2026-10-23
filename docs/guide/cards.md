# Cards

The **Card** section of the **Talk** tab holds who she is.

## What a card is

A card is the persona text of a preset: her name, who she is, how she talks, and how her conversations open. The client sends it to the backend with every turn on Chat Completions and Responses. The backend reads it and decides what she says; the client never writes her words. A push backend brings its own persona, so a preset on push has no card section.

::: v-pre

## The fields

| Field | What the backend reads it as |
|---|---|
| Name | Her name, and what `{{char}}` becomes |
| Description | Who she is: background, appearance, habits |
| Personality | A short list of her traits, sent as `Personality: …` |
| Scenario | The situation she is in, sent as `Scenario: …` |
| Greeting | The line she opens a new conversation with |
| More greetings | Other opening lines; one of these or the greeting is picked at random |
| Example dialogue | Sample exchanges that show how she talks, sent as `Example dialogue:` |
| System prompt | Replaces YUI's built-in framing sentence; `{{original}}` puts that sentence back in |
| Post-history instructions | A note sent after the conversation history on every turn |

Example dialogue, System prompt, and Post-history instructions sit under **Advanced**. An empty field sends nothing. The Name field renames the preset, so the preset strip and the card always show the same name.

## Macros

- `{{char}}` becomes her name.
- `{{user}}` becomes **Your name**. Left empty, it becomes the word for "User" in the UI language.
- `{{original}}` works in System prompt and becomes YUI's built-in framing sentence.

The client replaces these three and leaves any other `{{…}}` text as written.

## Default and own cards

A new preset starts with the **default card**: Yui, in the UI language. While the preset keeps the default card, changing the UI language changes the card to that language.

Editing any field gives the preset its **own card**. An own card stays as you wrote it when the UI language changes; only YUI's framing sentence and the fallback word for `{{user}}` follow the language. **Reset to default** returns the preset to the default card.

With **Send card** off, the backend receives only the expression instructions, with no persona.

## Greeting

After **Start fresh**, she speaks one greeting, picked at random from Greeting and More greetings. It shows in her speech bubble, plays in her voice, and is kept in the conversation history, so the backend reads it on the next turn. She does not greet when the app starts, on push, or with **Send card** off.

:::

## Learn more

- [Character design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) in the SillyTavern docs
- [Tavern Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2)
