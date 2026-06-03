# SSE Event Format (OpenAI Responses API Compatible)

LangGraph 스트림을 OpenAI Responses API 형식의 SSE 이벤트로 변환한다.  
구현체: `src/streaming/events.py`, `src/streaming/stream_adapter.py`

---

## 공통 구조

모든 SSE 이벤트는 아래 형식으로 전송된다.

```
event: <event-type>
data: <JSON payload>
```

`output_index`는 응답 전체 내 항목 순번 (0-based).  
`item_id`는 `item_` 접두 UUID, `response.id`는 `resp_` 접두 UUID.

---

## 이벤트 목록

### 1. `response.created`

스트림 시작 시 최초로 1회 전송된다.  
`metadata.thread_id`에 현재 세션의 thread ID가 담긴다 (멀티턴 대화 재개 시 사용).

```json
{
  "type": "response.created",
  "response": {
    "id": "resp_<24-hex>",
    "status": "in_progress",
    "output": [],
    "metadata": { "thread_id": "<uuid>" }
  }
}
```

---

### 2. `response.output_item.added`

새 출력 항목이 시작될 때 전송된다.  
`item` 필드에는 **message 항목** 또는 **function_call 항목** 중 하나가 온다.

#### 2-a. message 타입

항목이 처음 생성될 때는 `content: []`, `status: "in_progress"`로 전송된다.

```json
{
  "type": "response.output_item.added",
  "output_index": 0,
  "item": {
    "id": "item_<24-hex>",
    "type": "message",
    "status": "in_progress",
    "role": "assistant",
    "content": [],
    "metadata": {
      "node_id": "node-abc",
      "node_name": "My Agent"
    },
    "group_id": null
  }
}
```

#### 2-b. function_call 타입

```json
{
  "type": "response.output_item.added",
  "output_index": 1,
  "item": {
    "id": "fc_<24-hex>",
    "type": "function_call",
    "name": "calculator",
    "call_id": "<tool-call-id>",
    "arguments": "",
    "status": "in_progress"
  }
}
```

---

### 3. `response.content_part.added`

message 항목의 content part가 시작될 때 전송된다 (함수 호출 항목엔 없음).  
`text`는 항상 빈 문자열로 시작한다.

```json
{
  "type": "response.content_part.added",
  "item_id": "item_<24-hex>",
  "output_index": 0,
  "content_index": 0,
  "part": {
    "type": "output_text",
    "text": "",
    "annotations": []
  }
}
```

---

### 4. `response.output_text.delta`

LLM 텍스트 토큰이 스트리밍될 때마다 전송된다.  
END 노드에 연결된 스트리밍 대상 노드에서만 발생한다.

```json
{
  "type": "response.output_text.delta",
  "item_id": "item_<24-hex>",
  "output_index": 0,
  "content_index": 0,
  "delta": "안녕"
}
```

---

### 5. `response.function_call_arguments.delta`

툴 호출 argument가 스트리밍될 때마다 전송된다.

```json
{
  "type": "response.function_call_arguments.delta",
  "item_id": "fc_<24-hex>",
  "output_index": 1,
  "delta": "{\"a\": 1"
}
```

---

### 6. `response.output_text.done`

텍스트 스트리밍이 완료될 때 전송된다. `text`에 전체 누적 텍스트가 담긴다.

```json
{
  "type": "response.output_text.done",
  "item_id": "item_<24-hex>",
  "output_index": 0,
  "content_index": 0,
  "text": "안녕하세요. 무엇을 도와드릴까요?"
}
```

---

### 7. `response.function_call_arguments.done`

툴 호출 arguments가 완성됐을 때 전송된다.

```json
{
  "type": "response.function_call_arguments.done",
  "item_id": "fc_<24-hex>",
  "output_index": 1,
  "name": "calculator",
  "arguments": "{\"a\": 1, \"b\": 2}"
}
```

---

### 8. `response.content_part.done`

message 항목의 content part가 완료될 때 전송된다.

```json
{
  "type": "response.content_part.done",
  "item_id": "item_<24-hex>",
  "output_index": 0,
  "content_index": 0,
  "part": {
    "type": "output_text",
    "text": "안녕하세요. 무엇을 도와드릴까요?"
  }
}
```

---

### 9. `response.output_item.done`

출력 항목 하나가 완전히 완료될 때 전송된다.  
`item` 필드에 최종 상태가 담긴다.

#### message 타입

완료 시점에는 `status: "completed"`, `content`에 최종 텍스트가 담긴다.

```json
{
  "type": "response.output_item.done",
  "output_index": 0,
  "item": {
    "id": "item_<24-hex>",
    "type": "message",
    "status": "completed",
    "role": "assistant",
    "content": [
      { "type": "output_text", "text": "안녕하세요. 무엇을 도와드릴까요?", "annotations": [] }
    ],
    "metadata": { "node_id": "node-abc", "node_name": "My Agent" },
    "group_id": null
  }
}
```

#### function_call 타입

```json
{
  "type": "response.output_item.done",
  "output_index": 1,
  "item": {
    "id": "fc_<24-hex>",
    "type": "function_call",
    "name": "calculator",
    "call_id": "<tool-call-id>",
    "arguments": "{\"a\": 1, \"b\": 2}",
    "status": "completed"
  }
}
```

---

### 10. `response.completed`

스트림 종료 시 최후로 1회 전송된다.  
`output` 배열에 완료된 모든 message 항목들이 담긴다 (function_call 제외).

```json
{
  "type": "response.completed",
  "response": {
    "id": "resp_<24-hex>",
    "status": "completed",
    "output": [
      {
        "id": "item_<24-hex>",
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [
          { "type": "output_text", "text": "안녕하세요. 무엇을 도와드릴까요?", "annotations": [] }
        ],
        "metadata": { "node_id": "node-abc", "node_name": "My Agent" },
        "group_id": null
      }
    ],
    "metadata": { "thread_id": "<uuid>" }
  }
}
```

---

### 11. `error`

실행 중 예외 발생 시 전송된다. API 키 등 민감 정보는 `[REDACTED]`로 치환된다.

```json
{
  "type": "error",
  "code": "execution_error",
  "message": "Unexpected error occurred."
}
```

---

## 이벤트 시퀀스

### A. 텍스트 스트리밍 노드 (END-connected streaming node)

```
response.created
  └─ response.output_item.added        (type: message)
  └─ response.content_part.added
  └─ response.output_text.delta        × N  (토큰마다)
  └─ response.output_text.done
  └─ response.content_part.done
  └─ response.output_item.done
response.completed
```

### B. 비스트리밍 노드 (non-END node, 내부 처리 노드)

```
response.created
  └─ [function_call 항목이 있는 경우]
       response.output_item.added      (type: function_call)
       response.function_call_arguments.done
       response.output_item.done
  └─ response.output_item.added        (type: message)
  └─ response.content_part.added
  └─ response.content_part.done
  └─ response.output_item.done
response.completed
```

### C. 툴 호출 (스트리밍 LLM → tool 실행)

```
response.output_item.added            (type: function_call, status: in_progress)
response.function_call_arguments.delta  × N  (arguments 토큰마다)
response.function_call_arguments.done
response.output_item.done             (status: completed)
```

---

## 데이터 모델 요약

| 모델 | 필드 |
|---|---|
| `ResponseObject` | `id`, `status` (`in_progress`\|`completed`), `output[]`, `metadata` |
| `OutputItem` | `id`, `type="message"`, `status` (`in_progress`\|`completed`), `role="assistant"`, `content[]`, `metadata`, `group_id` |
| `OutputItemMetadata` | `node_id`, `node_name` (커스텀 확장) |
| `ContentPart` | `type="output_text"`, `text`, `annotations[]` |
| `FunctionCallItem` | `id`, `type="function_call"`, `name`, `call_id`, `arguments`, `status` |

> `ResponseObject.metadata.thread_id`: LangGraph 세션 연속성용 커스텀 확장. OpenAI 스펙의 `metadata` 슬롯을 활용.  
> `OutputItem.metadata`: 노드 정보 전달용 커스텀 확장.
