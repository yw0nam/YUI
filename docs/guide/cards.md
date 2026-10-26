# Cards

The **Card** section of the **Talk** tab holds who she is.

## What a card is

A card is the persona text of a preset: her name, who she is, how she talks, and how her conversations open. The client sends it to the backend with every turn on Chat Completions and Responses. The backend reads it and decides what she says; the client never writes her words. A push backend brings its own persona, so on push the card section keeps only **Import card…** and **Export card**.

::: v-pre

## The fields

| Field | What the backend reads it as |
|---|---|
| Name | Her name, and what `{{char}}` becomes |
| Description | Who she is: background, appearance, habits |
| Personality | A short list of her traits, sent as `Personality: …` |
| Scenario | The situation she is in, sent as `Scenario: …` |
| Greeting | The line she opens a new conversation with |
| More greetings | Other greetings; one of these or the greeting is picked at random |
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

After **Start fresh**, she speaks one greeting, picked at random from Greeting and More greetings. It shows in her speech bubble, plays in her voice, and is kept in the conversation history, so the backend reads it on the next turn. She does not greet when the app starts, on push, or with **Send card** off. A preset created by a card import greets once, from the card, when its window first boots.

## Import and export

**Import card…** at the bottom of the Card section reads a card file into a new preset. It reads JSON (`chara_card_v2`, `chara_card_v3`, or a bare V1 object) and PNG — PNG cards come from SillyTavern-compatible tools and card sites and open directly; a Character.AI character needs a community converter to a Tavern card first. The new preset takes the card's name; when a preset with that name already exists, the new one is named with a number ("Mio 2", "Mio 3", …), and because the card's name is the preset's name, that suffixed name is what she is called. The card becomes the preset's own card with **Send card** on. A PNG card's image is kept as the preset's thumbnail and shows on the preset strip and beside the Name field; removing the preset removes the file. The new preset becomes the active one, and she greets once from the card when its window first boots.

**Export card** writes the preset's card as `chara_card_v2` JSON through the OS save dialog, named after the preset. Fields only V3 knows are kept under `extensions`.

:::

## Learn more

- [Character design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) in the SillyTavern docs
- [Tavern Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2)
