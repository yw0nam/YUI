/**
 * Pure Chat Completions helpers: request-message builders, the client-declared
 * generate_express tool schema, and a streaming chunk reducer that normalizes
 * `chat.completion.chunk` deltas into renderer-agnostic items. No openai client
 * import, no import from chat-client.ts (chat-client imports from here).
 */

import type { ExpressArgs, Usage } from "../contract";
import type { ChatHistoryEntry } from "./chat-history-store";

// ─────────────────────────────────────────────────────────────────────────────
// Request messages
// ─────────────────────────────────────────────────────────────────────────────

export type CCContentPart =
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

export interface CCMessage {
  role: "system" | "user" | "assistant";
  content: string | CCContentPart[];
}

export interface BuildCCMessagesOpts {
  instructions?: string;
  clientContextJson: string;
  transcript: ChatHistoryEntry[];
  userText: string;
  imageDataUrls?: string[];
}

export function buildCCMessages(opts: BuildCCMessagesOpts): CCMessage[] {
  const messages: CCMessage[] = [];

  if (opts.instructions) {
    messages.push({ role: "system", content: opts.instructions });
  }
  messages.push({ role: "system", content: `client_context: ${opts.clientContextJson}` });

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
// generate_express tool schema (client-declared, CC mode only)
// ─────────────────────────────────────────────────────────────────────────────

export interface CCTool {
  type: "function";
  function: {
    name: "generate_express";
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: "string"; enum?: string[] }>;
      additionalProperties: false;
    };
  };
}

export function buildExpressTool(emotionIds: string[], motionIds: string[]): CCTool {
  return {
    type: "function",
    function: {
      name: "generate_express",
      description:
        "Sets the expression cue — facial emotion, body motion, and voice tone — for the sentence that follows. Call it between sentences; a cue applies only to the next segment and does not persist across sentences.",
      parameters: {
        type: "object",
        properties: {
          emotion_id: { type: "string", enum: emotionIds },
          motion_id: { type: "string", enum: motionIds },
          emotion_text: { type: "string" },
        } satisfies Record<keyof ExpressArgs, { type: "string"; enum?: string[] }>,
        additionalProperties: false,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming chunk reducer
// ─────────────────────────────────────────────────────────────────────────────

export type ReducerItem =
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

  function flushToolCalls(): ReducerItem[] {
    if (buffers.size === 0) return [];
    const indices = [...buffers.keys()].sort((a, b) => a - b);
    const items: ReducerItem[] = indices.map((i) => {
      const buf = buffers.get(i) as ToolCallBuffer;
      return { kind: "tool_call", id: buf.id, name: buf.name, argsJson: buf.argsJson };
    });
    buffers.clear();
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
              if (typeof t.index !== "number") continue;

              let buf = buffers.get(t.index);
              if (!buf) {
                buf = { id: undefined, name: "", argsJson: "" };
                buffers.set(t.index, buf);
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
