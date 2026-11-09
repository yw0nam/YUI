# Cards

A card holds her persona: her name, who she is, how she talks, and how a conversation opens.

![Settings window, Persona page with the default card shown](/shots/settings-persona.png)

## Import, edit, and export

1. **Import…** on the Persona page reads a [preset file](#preset-file) (`.yui`), a JSON card (`chara_card_v2`, `chara_card_v3`, or V1), or a PNG card from a SillyTavern-compatible tool. A Character.AI character needs a converter first.
    - The new preset takes the card's name, with a number added when that name is taken. It becomes the active preset and gets the card as its own card, with **Send card** on.
    - A PNG card's image becomes the preset's photo, framed on its top square. The photo button reframes it, and removing the preset deletes the file.
2. Edit any field below.
    - An empty field sends nothing. Name renames the preset too.
    - **Advanced** reveals Example dialogue, System prompt, and Post-history instructions.
    - **Reset to default** returns the preset to the default card.
    - With **Send card** off, the backend gets only the expression instructions.
3. **Export preset (.yui)** opens the list of what the [preset file](#preset-file) carries, under the buttons.
4. **Export card only (PNG)** writes the card into the preset's photo and saves it as a PNG card at once, with no rights check. It stays off while the preset has no photo.
    - Both exports write the card as `chara_card_v2`, named after the preset. Fields that only V3 knows stay under `extensions`, and import keeps them.
    - Filler phrases are kept in `extensions.yui.filler`, so an exported card imports back with them.

## Preset file

A preset file is one `.yui` file holding the card, the photo with its framing, the VRM, and the voice's reference clip. API keys, connection settings, chat history, and relation values never go in.

- **VRM.** A VRM that ships with the app goes in by name only. An imported VRM 1.0 is left out unless `allowRedistribution` is true.
- **VRM 0.x.** It is left out under `Redistribution_Prohibited` and goes in under any other license name. With no license, or `Other`, the list shows **Check needed** and the VRM still goes in.
- **Voice.** An imported voice's reference clip goes in. A voice with no local clip, such as the TTS server's own voice or a pasted voice id, is left out.
- **Rights check.** **Export…** stays off until the switch "I have the right to share these files" is on.
- **Import.** A preset file creates a new preset. Its VRM joins the VRM list and is selected for that preset. A VRM that ships with the app is selected when this app has it.
- **Voice on import.** The clip is registered with your TTS server and selected when the provider takes reference clips (Irodori, Fish Audio). Otherwise the preset keeps the default voice, and a line under the buttons says the voice could not be registered.

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

- A preset starts on the default card, Yui in the UI language, and follows a language change. Editing a field gives it its own card. That card stays as you wrote it. Only YUI's framing sentence and the `{{user}}` fallback follow the language.
- After **Start fresh**, she speaks one greeting at random and keeps it in the history.
- She does not greet at app start, on push, or with **Send card** off. An imported preset greets once from its card when its window first boots.
- She also greets once when the First conversation page connects on an empty session.
- On push the card section disables **Send card**, the fields, and the greetings. The **Name** field stays editable.

:::

## Learn more

- [Character design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) in the SillyTavern docs
- [Tavern Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2)
