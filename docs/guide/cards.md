# Cards

A card holds her persona: her name, who she is, how she talks, and how a conversation opens.

![Settings window, Persona page with a card loaded](/shots/settings-persona.png)

## Import, edit, and export

1. **Import card…** on the Persona page reads JSON (`chara_card_v2`, `chara_card_v3`, or V1) or a PNG card from a SillyTavern-compatible tool; a Character.AI character needs a converter first. The new preset takes the card's name, numbered when that name is taken, becomes the active preset, and gets the card as its own card with **Send card** on. A PNG card's image becomes the preset's photo, framed on its top square; the photo button reframes it, and removing the preset deletes the file.
2. Edit any field below; an empty field sends nothing, and Name renames the preset too. **Advanced** reveals Example dialogue, System prompt, and Post-history instructions, and **Reset to default** returns the preset to the default card. With **Send card** off, the backend gets only the expression instructions.
3. **Export card** writes `chara_card_v2` JSON through the save dialog, named after the preset. Fields only V3 knows stay under `extensions`, which import keeps, and filler phrases ride in `extensions.yui.filler`, so an exported card imports back with them.

::: v-pre

## The fields

| Field | What the backend reads it as |
| --- | --- |
| Name | Her name, and what `{{char}}` becomes |
| Description | Who she is: background, appearance, habits |
| Personality | Her traits, sent as `Personality: …` |
| Scenario | The situation she is in, sent as `Scenario: …` |
| Greeting | The line she opens a new conversation with |
| More greetings | Other greetings, one of them picked at random |
| Example dialogue | Sample exchanges, sent as `Example dialogue:` |
| System prompt | Replaces YUI's framing sentence; `{{original}}` puts it back |
| Post-history instructions | A note sent after the history on every turn |

## Macros

- `{{char}}` becomes her name.
- `{{user}}` becomes **Your name**, or the word for "User" in the UI language when empty.
- `{{original}}` works in System prompt and becomes YUI's framing sentence.

The client replaces these three and leaves any other `{{…}}` text as written.

## Tips

- A new preset starts on the default card, Yui in the UI language, and follows a language change. Editing a field gives it its own card, which stays as you wrote it.
- After **Start fresh** she speaks one greeting at random and keeps it in the history. She does not greet at app start, on push, or with **Send card** off, and an imported preset greets once from its card when its window first boots.
- On push the card section keeps only **Import card…** and **Export card**.

:::

## Learn more

- [Character design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) in the SillyTavern docs
- [Tavern Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2)
