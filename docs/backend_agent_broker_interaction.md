# Backend Agent ↔ Broker Interaction

## Purpose

Use `generate_express` to place expression cues between streamed assistant text segments.

The assistant reply is still normal streamed text. `generate_express` is called at the point where the face, motion, or voice tone should change.

## Tool Arguments

```ts
generate_express({
  emotion_id?: string;
  motion_id?: string;
  emotion_text?: string;
})
```

```json
{
  "emotion_id": "happy",
  "motion_id": "dance",
  "emotion_text": "🤭"
}
```

| Field | Use |
|---|---|
| `emotion_id` | facial expression |
| `motion_id` | body motion |
| `emotion_text` | voice tone tag |

All fields are optional. Include only the fields that should change.

## Basic Pattern

Interleave text and tool calls in the order the user should experience them.

```text
text segment
generate_express({ ...cue for that segment... })
text segment
generate_express({ ...cue for that segment... })
```

Example:

```text
"안녕 영우야!"
generate_express({ emotion_id: "happy", motion_id: "dance", emotion_text: "🤭" })
" 오늘 하루는 어땠어?"
generate_express({ emotion_id: "curious", motion_id: "calm", emotion_text: "😏" })
```

This means:

- say `"안녕 영우야!"`;
- place a happy/dance/🤭 cue on that greeting;
- say `" 오늘 하루는 어땠어?"`;
- place a curious/calm/😏 cue on the question.

## Streaming Shape

```text
event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"안녕 영우야!","sequence_number":2}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"happy\",\"motion_id\":\"dance\",\"emotion_text\":\"🤭\"}"},"sequence_number":3}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":1,"item":{"id":"fc_1","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"happy\",\"motion_id\":\"dance\",\"emotion_text\":\"🤭\"}"},"sequence_number":4}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_1","delta":" 오늘 하루는 어땠어?","sequence_number":5}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":2,"item":{"id":"fc_2","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"curious\",\"motion_id\":\"calm\",\"emotion_text\":\"😏\"}"},"sequence_number":6}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":2,"item":{"id":"fc_2","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"curious\",\"motion_id\":\"calm\",\"emotion_text\":\"😏\"}"},"sequence_number":7}

event: response.output_text.done
data: {"type":"response.output_text.done","item_id":"msg_1","text":"안녕 영우야! 오늘 하루는 어땠어?","sequence_number":8}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"안녕 영우야! 오늘 하루는 어땠어?"}]}]},"sequence_number":9}
```

## Rules

- Put spoken words only in streamed assistant text.
- Put expression, motion, and voice tone only in `generate_express` arguments.
- Call `generate_express` multiple times when one reply has multiple expressive beats.
- Do not encode expression cues as inline text such as `[happy]`.
- Do not put the spoken sentence inside `generate_express`.

## Bad Patterns

```text
"[happy][dance] 안녕 영우야!"
```

```text
generate_express({
  emotion_text: "안녕 영우야!"
})
```

```text
"안녕 영우야! 오늘 하루는 어땠어?"
generate_express({ emotion_id: "happy" })
```

The last example loses the timing. Use separate cues when different parts of the sentence need different expression.
