/**
 * generate_express — the expression-cue tool.
 *
 * Its schema carries the vocabulary the client has loaded (the same ids published to the
 * broker), and its cue plays from the express stream event the engine emits the moment the
 * call arrives, so execute only acknowledges the call.
 */

import type { ExpressVocabulary } from "../vocabulary/express-vocabulary";
import type { ClientTool, ClientToolDefinition } from "./client-tools";

/**
 * The cue contract in the words the model reads before calling. Full statement of it:
 * docs/reference/client-context.md. Body motion drops out of the sentence when the curated
 * vocabulary carries no motion, so the description never promises a parameter the schema omits.
 */
function expressDescription(withMotion: boolean): string {
  const channels = withMotion
    ? "facial expression, body motion, and voice tone"
    : "facial expression and voice tone";
  return (
    `Place an expression cue on the speech around this call: ${channels}. Call it per sentence ` +
    "or expressive beat, at the point where the expression should change, and include only the " +
    "fields that change. Spoken words never go in the arguments."
  );
}

/**
 * voice tone tag schema. In enum mode the TTS voice speaks a fixed tag table, so the tags and
 * their meanings ride in the schema; free mode asks for a few plain words the provider reads as
 * prose.
 */
function emotionTextSchema(emotionText: ExpressVocabulary["emotionText"]): Record<string, unknown> {
  const table = emotionText.mode === "enum" ? emotionText.table : null;
  if (!table) {
    return {
      type: "string",
      description: 'voice tone in a few plain words (e.g. "warm, teasing"), no emoji or symbols',
    };
  }
  const meanings = Object.entries(table)
    .map(([tag, meaning]) => `${tag} = ${meaning}`)
    .join("; ");
  return {
    type: "string",
    description: `voice tone tag — ${meanings}`,
    enum: Object.keys(table),
  };
}

/**
 * Built from the same vocabulary the broker publishes (deriveExpressVocabulary). A
 * curated-empty motion list drops motion_id rather than declaring an unfillable empty enum.
 */
export function createGenerateExpressTool(vocab: ExpressVocabulary): ClientTool {
  const withMotion = vocab.motionIds.length > 0;
  const definition: ClientToolDefinition = {
    type: "function",
    function: {
      name: "generate_express",
      description: expressDescription(withMotion),
      parameters: {
        type: "object",
        properties: {
          emotion_id: {
            type: "string",
            description: "facial expression",
            enum: vocab.emotionIds,
          },
          ...(withMotion
            ? {
                motion_id: {
                  type: "string",
                  description: "body motion",
                  enum: vocab.motionIds,
                },
              }
            : {}),
          emotion_text: emotionTextSchema(vocab.emotionText),
          caption: {
            type: "string",
            description:
              "voice direction in natural language, applied to the " +
              "speech around this call — independent of emotion_text, and omitted when the " +
              "default voice fits",
          },
        },
        additionalProperties: false,
      },
    },
  };
  return {
    name: "generate_express",
    definition,
    execute: async () => "ok",
    waitMs: 2000,
    oneWay: true,
    push: false,
  };
}
