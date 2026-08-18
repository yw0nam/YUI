/**
 * Pure Chat Completions helpers: request-message builders and a streaming chunk
 * reducer that normalizes `chat.completion.chunk` deltas into renderer-agnostic
 * items. No openai client import, no import from chat-client.ts (chat-client
 * imports from here).
 */

import type { Usage } from "../contract";
import type { ChatHistoryEntry } from "./chat-history-store";

// ─────────────────────────────────────────────────────────────────────────────
// Request messages
// ─────────────────────────────────────────────────────────────────────────────

type CCContentPart =
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

/** One tool call as it rides on an assistant message. */
export interface CCToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type CCMessage =
  | { role: "system" | "user" | "assistant"; content: string | CCContentPart[] }
  /** The assistant turn that called tools — its own text, if any, plus the calls. */
  | { role: "assistant"; content: string | null; tool_calls: CCToolCall[] }
  /** One executed call's result. */
  | { role: "tool"; tool_call_id: string; content: string };

interface BuildCCMessagesOpts {
  instructions?: string;
  clientContextText: string;
  transcript: ChatHistoryEntry[];
  userText: string;
  imageDataUrls?: string[];
}

export function buildCCMessages(opts: BuildCCMessagesOpts): CCMessage[] {
  const messages: CCMessage[] = [];

  if (opts.instructions) {
    messages.push({ role: "system", content: opts.instructions });
  }
  messages.push({ role: "system", content: `client_context:\n${opts.clientContextText}` });

  for (const entry of opts.transcript) {
    messages.push({ role: entry.role, content: entry.text });
  }

  const images = opts.imageDataUrls ?? [];
  const userContent: string | CCContentPart[] =
    images.length === 0
      ? opts.userText
      : [
          ...images.map((url): CCContentPart => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: opts.userText },
        ];
  messages.push({ role: "user", content: userContent });

  return messages;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming chunk reducer
// ─────────────────────────────────────────────────────────────────────────────

type ReducerItem =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string | undefined; name: string; argsJson: string }
  | { kind: "usage"; usage: Partial<Usage> }
  | { kind: "finish"; reason: string };

interface ToolCallBuffer {
  id: string | undefined;
  name: string;
  argsJson: string;
}

export function createChunkReducer() {
  const buffers = new Map<number, ToolCallBuffer>();
  // Index synthesis for servers that omit `index`: an id keeps its own slot, and a fragment
  // carrying neither continues the call opened most recently.
  const indexById = new Map<string, number>();
  let lastSynthesizedIndex = 0;

  function resolveIndex(t: Record<string, unknown>): number {
    const id = typeof t.id === "string" ? t.id : undefined;
    if (typeof t.index === "number") {
      // Remember it too: a later fragment may carry the id alone.
      if (id !== undefined) indexById.set(id, t.index);
      return t.index;
    }
    if (id === undefined) return lastSynthesizedIndex;
    const known = indexById.get(id);
    if (known !== undefined) return known;
    const next = buffers.size === 0 ? 0 : Math.max(...buffers.keys()) + 1;
    indexById.set(id, next);
    lastSynthesizedIndex = next;
    return next;
  }

  function flushToolCalls(): ReducerItem[] {
    if (buffers.size === 0) return [];
    const indices = [...buffers.keys()].sort((a, b) => a - b);
    const items: ReducerItem[] = indices.map((i) => {
      const buf = buffers.get(i) as ToolCallBuffer;
      return { kind: "tool_call", id: buf.id, name: buf.name, argsJson: buf.argsJson };
    });
    buffers.clear();
    indexById.clear();
    lastSynthesizedIndex = 0;
    return items;
  }

  return {
    feed(chunk: unknown): ReducerItem[] {
      if (chunk === null || typeof chunk !== "object") return [];
      const c = chunk as Record<string, unknown>;
      const items: ReducerItem[] = [];

      // usage arrives on the final chunk (typically with empty choices), from
      // stream_options: { include_usage: true }.
      if (c.usage !== null && typeof c.usage === "object") {
        const u = c.usage as Record<string, unknown>;
        items.push({
          kind: "usage",
          usage: {
            input_tokens: u.prompt_tokens as number | undefined,
            output_tokens: u.completion_tokens as number | undefined,
            total_tokens: u.total_tokens as number | undefined,
          },
        });
      }

      const choices = Array.isArray(c.choices) ? c.choices : [];
      for (const choice of choices) {
        if (choice === null || typeof choice !== "object") continue;
        const ch = choice as Record<string, unknown>;
        const delta = ch.delta;

        if (delta !== null && typeof delta === "object") {
          const d = delta as Record<string, unknown>;

          // Only delta.content is speech — reasoning_content/reasoning/thinking
          // are ignored by construction (never read).
          if (typeof d.content === "string" && d.content.length > 0) {
            items.push({ kind: "text", text: d.content });
          }

          if (Array.isArray(d.tool_calls)) {
            for (const tc of d.tool_calls) {
              if (tc === null || typeof tc !== "object") continue;
              const t = tc as Record<string, unknown>;
              const index = resolveIndex(t);

              let buf = buffers.get(index);
              if (!buf) {
                buf = { id: undefined, name: "", argsJson: "" };
                buffers.set(index, buf);
              }
              if (typeof t.id === "string") buf.id = t.id;
              if (t.function !== null && typeof t.function === "object") {
                const fn = t.function as Record<string, unknown>;
                if (typeof fn.name === "string") buf.name = fn.name;
                if (typeof fn.arguments === "string") buf.argsJson += fn.arguments;
              }
            }
          }
        }

        if (typeof ch.finish_reason === "string") {
          items.push(...flushToolCalls());
          items.push({ kind: "finish", reason: ch.finish_reason });
        }
      }

      return items;
    },

    finish(): ReducerItem[] {
      return flushToolCalls();
    },
  };
}
