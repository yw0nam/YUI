import { describe, expect, it } from "vitest";
import { createConversationStores } from "./conversation-stores";

describe("createConversationStores", () => {
  it("constructs exactly the five cross-window conversation stores", () => {
    const stores = createConversationStores();

    expect(Object.keys(stores)).toEqual([
      "contextHistory",
      "sessionStore",
      "sessionDiagnostics",
      "chatHistoryStore",
      "overheardStore",
    ]);
    // Every window iterates the bag for teardown, so each store must be disposable.
    for (const store of Object.values(stores)) {
      expect(typeof store.dispose).toBe("function");
      store.dispose();
    }
  });
});
