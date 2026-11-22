import { describe, expect, it } from "vitest";
import { INITIAL_KEY_STATE, keyChecked, keyView, keyWritten, openKey } from "./key-state";

const shown = (view: ReturnType<typeof keyView>) =>
  Object.entries(view)
    .filter(([, on]) => on === true)
    .map(([part]) => part);

describe("keyView", () => {
  it.each([
    ["the setup state", INITIAL_KEY_STATE, false, ["replaceButton", "makeRow", "paste", "done"]],
    ["the connected state", INITIAL_KEY_STATE, true, ["keyRow", "replaceButton", "done"]],
    ["Replace key opened", openKey(INITIAL_KEY_STATE), true, ["keyRow", "paste", "done"]],
    [
      "a refused stored key",
      keyChecked(INITIAL_KEY_STATE, false),
      true,
      ["replaceButton", "makeRow", "paste", "rejected"],
    ],
    [
      "a passing key with the paste row open",
      keyChecked(openKey(INITIAL_KEY_STATE), true),
      true,
      ["keyRow", "paste", "done", "keyOk"],
    ],
  ])("%s shows its parts", (_, state, connected, parts) => {
    expect(shown(keyView(state, connected))).toEqual(parts);
  });

  it("a key that passes after a refusal keeps the paste row open and says it still works", () => {
    const state = keyChecked(keyChecked(INITIAL_KEY_STATE, false), true);

    expect(shown(keyView(state, true))).toEqual(["keyRow", "paste", "done", "keyOk"]);
  });

  it("a written key closes the rows and says Key replaced only when it replaced one", () => {
    expect(keyView(keyWritten(true), true)).toMatchObject({
      paste: false,
      rejected: false,
      doneText: "start.key_replaced",
    });
    expect(keyWritten(false)).toEqual(INITIAL_KEY_STATE);
  });
});
