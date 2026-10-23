/**
 * import-card-preset.test.ts — creating a preset from an imported card.
 *
 * Pins src/settings/preset/import-card-preset.ts: name suffixing, the card merged into
 * the copied yui.agent with the send switch on, the thumbnail retained onto the entry,
 * the pending greeting, activation, and the cleanup that leaves no orphan preset or
 * thumbnail. The registry is a fake and storage is in-memory.
 */

import { describe, expect, it, vi } from "vitest";
import { readCard } from "../../config/validators/persona/read-card";
import { type Card } from "../../config/validators/persona/types";
import { toV2Envelope } from "../../io/chat/card/serialize-card";
import { resolveStorageKey } from "./preset-keys";
import { createPresetFromCard } from "./import-card-preset";

/** A card as a V3 import produces it: V3-only extras under extensions.chara_card_v3. */
const v3Card = (): Card =>
  readCard({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Mio",
      description: "desc",
      creator: "someone",
      tags: ["a", "b"],
      nickname: "Mii",
      group_only_greetings: [],
    },
  }).card;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function fakeRegistry(
  seed: Array<{ id: string; name: string }> = [],
  ids: string[] = [],
): {
  registry: {
    create(name: string): string | null;
    setThumbnail(id: string, url: string | undefined): boolean;
    activate(id: string): boolean;
    remove(id: string): boolean;
  };
  list: Array<{ id: string; name: string; thumbnail?: string }>;
  removed: string[];
  activated: string[];
} {
  const list = seed.map((entry) => ({ ...entry }));
  const removed: string[] = [];
  const activated: string[] = [];
  let next = 0;
  return {
    registry: {
      create(name: string): string | null {
        const trimmed = name.trim();
        if (!trimmed || list.some((e) => e.name === trimmed)) return null;
        const id = ids[next] ?? `id${next + 1}`;
        next += 1;
        list.push({ id, name: trimmed });
        return id;
      },
      setThumbnail: vi.fn((id: string, url: string | undefined): boolean => {
        const entry = list.find((e) => e.id === id);
        if (!entry) return false;
        if (url === undefined) delete entry.thumbnail;
        else entry.thumbnail = url;
        return true;
      }),
      activate: vi.fn((id: string): boolean => {
        if (!list.some((e) => e.id === id)) return false;
        activated.push(id);
        return true;
      }),
      remove: vi.fn((id: string): boolean => {
        const at = list.findIndex((e) => e.id === id);
        if (at === -1) return false;
        removed.push(id);
        list.splice(at, 1);
        return true;
      }),
    },
    list,
    removed,
    activated,
  };
}

describe("createPresetFromCard", () => {
  it("suffixes the name past an existing name 2", async () => {
    const { registry, list } = fakeRegistry(
      [
        { id: "default", name: "default" },
        { id: "a1", name: "Mio" },
        { id: "a2", name: "Mio 2" },
      ],
      ["n1", "n2", "n3"],
    );
    const id = await createPresetFromCard({ registry, card: v3Card(), storage: memoryStorage() });
    expect(id).toBe("n3");
    expect(list.at(-1)).toEqual({ id: "n3", name: "Mio 3" });
  });

  it("merges the card into the copied agent value with the send switch on", async () => {
    const { registry } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    storage.setItem(
      resolveStorageKey("yui.agent", "n1"),
      JSON.stringify({ reasoning_effort: "low", send_card: true, card: null }),
    );
    const id = await createPresetFromCard({ registry, card: v3Card(), storage });
    const agent = JSON.parse(storage.getItem(resolveStorageKey("yui.agent", id))!);
    expect(agent.reasoning_effort).toBe("low");
    expect(agent.send_card).toBe(true);
    expect(agent.card).toEqual(v3Card());
    const envelope = toV2Envelope(agent.card, agent.card.name);
    expect(envelope.data.extensions).toEqual({
      chara_card_v3: { nickname: "Mii", group_only_greetings: [] },
    });
    expect(envelope.data.creator).toBe("someone");
    expect(envelope.data.tags).toEqual(["a", "b"]);
    expect(envelope.data.name).toBe("Mio");
  });

  it("writes the pending greeting and activates the new preset", async () => {
    const { registry, activated } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    const id = await createPresetFromCard({ registry, card: v3Card(), storage });
    expect(storage.getItem(resolveStorageKey("yui.greeting-pending", id))).toBe("1");
    expect(activated).toEqual([id]);
  });

  it("stores the retained thumbnail URL on the new entry", async () => {
    const { registry, list } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const retainThumbnail = vi.fn(async () => "asset://localhost/app-data/cards/n1.png");
    const id = await createPresetFromCard({
      registry,
      card: v3Card(),
      retainThumbnail,
      storage: memoryStorage(),
    });
    expect(retainThumbnail).toHaveBeenCalledWith(id);
    expect(list.find((e) => e.id === id)?.thumbnail).toBe(
      "asset://localhost/app-data/cards/n1.png",
    );
  });

  it("a failing retention removes the preset and discards the thumbnail", async () => {
    const { registry, removed } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const discardThumbnail = vi.fn(async () => {});
    await expect(
      createPresetFromCard({
        registry,
        card: v3Card(),
        storage: memoryStorage(),
        retainThumbnail: vi.fn(async () => {
          throw new Error("thumbnail retain failed");
        }),
        discardThumbnail,
      }),
    ).rejects.toThrow("thumbnail retain failed");
    expect(removed).toEqual(["n1"]);
    expect(discardThumbnail).toHaveBeenCalledWith("n1");
  });

  it("a refused thumbnail entry removes the preset and discards the thumbnail", async () => {
    const fake = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    vi.mocked(fake.registry.setThumbnail).mockReturnValue(false);
    const discardThumbnail = vi.fn(async () => {});
    await expect(
      createPresetFromCard({
        registry: fake.registry,
        card: v3Card(),
        storage: memoryStorage(),
        retainThumbnail: vi.fn(async () => "asset://localhost/app-data/cards/n1.png"),
        discardThumbnail,
      }),
    ).rejects.toThrow("preset_create_failed");
    expect(fake.removed).toEqual(["n1"]);
    expect(discardThumbnail).toHaveBeenCalledWith("n1");
  });
});
