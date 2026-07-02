import type { EndpointsConfig } from "../../contract";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateEndpoints(file: string, raw: unknown): EndpointsConfig {
  const issues: string[] = [];
  if (!isObject(raw)) {
    throw new ConfigError(file, ["객체가 아님"]);
  }
  const httpUrl = (k: string): string => {
    const v = raw[k];
    if (typeof v !== "string" || !/^https?:\/\//.test(v)) {
      issues.push(`${k}는 http(s) URL이어야 함 (받음: ${JSON.stringify(v)})`);
      return "";
    }
    return v;
  };
  const chat_base_url = httpUrl("chat_base_url");
  const stt_base_url = httpUrl("stt_base_url");
  const tts_base_url = httpUrl("tts_base_url");
  const chat_endpoint = raw.chat_endpoint;
  // "/v1/responses" 형태의 경로만 허용. "//host"(protocol-relative)는 base_url과 합쳐도
  // 경로로 동작하지 않으므로 거부한다.
  if (
    typeof chat_endpoint !== "string" ||
    !chat_endpoint.startsWith("/") ||
    chat_endpoint.startsWith("//")
  ) {
    issues.push(
      `chat_endpoint는 "/"로 시작하는 경로여야 함 (받음: ${JSON.stringify(chat_endpoint)})`,
    );
  }
  // chat_model: optional. 있으면 비어있지 않은 문자열이어야 함(모델 ID는 config 소관).
  const chat_model = raw.chat_model;
  if (chat_model !== undefined && (typeof chat_model !== "string" || chat_model.trim() === "")) {
    issues.push(`chat_model은 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(chat_model)})`);
  }
  // chat_instructions: optional. 있으면 문자열이어야 함(Responses `instructions` nudge, config 소관).
  const chat_instructions = raw.chat_instructions;
  if (chat_instructions !== undefined && typeof chat_instructions !== "string") {
    issues.push(`chat_instructions는 문자열이어야 함 (받음: ${JSON.stringify(chat_instructions)})`);
  }
  // chat_api: optional enum. 설정 시 "responses"|"chat_completions"만 허용, 미설정 시 생략(상위 default).
  const rawChatApi = raw.chat_api;
  if (rawChatApi !== undefined && rawChatApi !== "responses" && rawChatApi !== "chat_completions") {
    issues.push(
      `chat_api는 "responses" | "chat_completions" 중 하나여야 함 (받음: ${JSON.stringify(rawChatApi)})`,
    );
  }
  const chat_api: EndpointsConfig["chat_api"] =
    rawChatApi === "responses" || rawChatApi === "chat_completions" ? rawChatApi : undefined;
  // tts_model / tts_voice: optional. 미설정 시 TTS 서비스 기본값.
  const optStr = (k: "tts_model" | "tts_voice"): string | undefined => {
    const v = raw[k];
    if (v !== undefined && (typeof v !== "string" || v.trim() === "")) {
      issues.push(`${k}는 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(v)})`);
      return undefined;
    }
    return typeof v === "string" ? v : undefined;
  };
  const tts_model = optStr("tts_model");
  const tts_voice = optStr("tts_voice");
  // tts_speed: optional, [0.25, 4.0].
  const tts_speed = raw.tts_speed;
  if (
    tts_speed !== undefined &&
    (typeof tts_speed !== "number" || tts_speed < 0.25 || tts_speed > 4)
  ) {
    issues.push(`tts_speed는 0.25~4.0 숫자여야 함 (받음: ${JSON.stringify(tts_speed)})`);
  }

  // ── irodori_TTS provider (additive) ──────────────────────────────────────────
  // tts_provider: optional enum. 미설정 시 irodori로 resolve(출력엔 resolved 값을 박는다).
  const rawProvider = raw.tts_provider;
  if (rawProvider !== undefined && rawProvider !== "openai" && rawProvider !== "irodori") {
    issues.push(
      `tts_provider는 "openai" | "irodori" 중 하나여야 함 (받음: ${JSON.stringify(rawProvider)})`,
    );
  }
  const tts_provider: EndpointsConfig["tts_provider"] =
    rawProvider === "openai" ? "openai" : "irodori";

  // provider=irodori면 base_url(http url) + speaker(non-empty)는 필수 — bare config fail-loud.
  let irodori_base_url: string | undefined;
  if (raw.irodori_base_url !== undefined || tts_provider === "irodori") {
    irodori_base_url = httpUrl("irodori_base_url");
  }
  const irodori_speaker = raw.irodori_speaker;
  if (tts_provider === "irodori" || irodori_speaker !== undefined) {
    if (typeof irodori_speaker !== "string" || irodori_speaker.trim() === "") {
      issues.push(
        `irodori_speaker는 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(irodori_speaker)})`,
      );
    }
  }

  // irodori_voices: optional. 배열이며 각 항목은 {id, ref_url("/" 시작), label?}.
  type IrodoriVoice = NonNullable<EndpointsConfig["irodori_voices"]>[number];
  let irodori_voices: IrodoriVoice[] | undefined;
  const rawVoices = raw.irodori_voices;
  if (rawVoices !== undefined) {
    if (!Array.isArray(rawVoices)) {
      issues.push(`irodori_voices는 배열이어야 함 (받음: ${JSON.stringify(rawVoices)})`);
    } else {
      irodori_voices = [];
      rawVoices.forEach((entry, i) => {
        if (!isObject(entry)) {
          issues.push(`irodori_voices[${i}]: 항목이 객체가 아님`);
          return;
        }
        if (typeof entry.id !== "string" || entry.id.length === 0) {
          issues.push(
            `irodori_voices[${i}].id는 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(entry.id)})`,
          );
        }
        if (typeof entry.ref_url !== "string" || !entry.ref_url.startsWith("/")) {
          issues.push(
            `irodori_voices[${i}].ref_url는 "/"로 시작하는 경로여야 함 (받음: ${JSON.stringify(entry.ref_url)})`,
          );
        }
        if (entry.label !== undefined && typeof entry.label !== "string") {
          issues.push(
            `irodori_voices[${i}].label는 문자열이어야 함 (받음: ${JSON.stringify(entry.label)})`,
          );
        }
        irodori_voices!.push({
          id: entry.id as string,
          ref_url: entry.ref_url as string,
          ...(typeof entry.label === "string" ? { label: entry.label } : {}),
        });
      });
    }
  }

  // irodori_num_steps: optional, 정수 ≥ 1.
  const irodori_num_steps = raw.irodori_num_steps;
  if (
    irodori_num_steps !== undefined &&
    (typeof irodori_num_steps !== "number" ||
      !Number.isInteger(irodori_num_steps) ||
      irodori_num_steps < 1)
  ) {
    issues.push(
      `irodori_num_steps는 1 이상 정수여야 함 (받음: ${JSON.stringify(irodori_num_steps)})`,
    );
  }
  // irodori_cfg_scale_text / _speaker / seconds: optional, 유한 number > 0.
  const posNum = (
    k: "irodori_cfg_scale_text" | "irodori_cfg_scale_speaker" | "irodori_seconds",
  ): void => {
    const v = raw[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v <= 0)) {
      issues.push(`${k}는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(v)})`);
    }
  };
  posNum("irodori_cfg_scale_text");
  posNum("irodori_cfg_scale_speaker");
  posNum("irodori_seconds");
  // broker_base_url: optional. 있으면 http(s) URL이어야 함(Expression Broker MCP endpoint).
  let broker_base_url: string | undefined;
  if (raw.broker_base_url !== undefined) {
    broker_base_url = httpUrl("broker_base_url");
  }
  // tts_max_inflight: optional, 정수 ≥ 1.
  const tts_max_inflight = raw.tts_max_inflight;
  if (
    tts_max_inflight !== undefined &&
    (typeof tts_max_inflight !== "number" ||
      !Number.isInteger(tts_max_inflight) ||
      tts_max_inflight < 1)
  ) {
    issues.push(
      `tts_max_inflight는 1 이상 정수여야 함 (받음: ${JSON.stringify(tts_max_inflight)})`,
    );
  }

  // ── context window ───────────────────────────────────────────────────────────
  // chat_model_context_window: optional, 유한 number > 0. 미설정 시 undefined.
  const chat_model_context_window = raw.chat_model_context_window;
  if (
    chat_model_context_window !== undefined &&
    (typeof chat_model_context_window !== "number" ||
      !Number.isFinite(chat_model_context_window) ||
      chat_model_context_window <= 0)
  ) {
    issues.push(
      `chat_model_context_window는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(chat_model_context_window)})`,
    );
  }

  assertValid(file, issues);
  return {
    chat_base_url,
    chat_endpoint: chat_endpoint as string,
    ...(typeof chat_instructions === "string" ? { chat_instructions } : {}),
    ...(typeof chat_model === "string" ? { chat_model } : {}),
    ...(chat_api !== undefined ? { chat_api } : {}),
    stt_base_url,
    tts_base_url,
    ...(tts_model !== undefined ? { tts_model } : {}),
    ...(tts_voice !== undefined ? { tts_voice } : {}),
    ...(typeof tts_speed === "number" ? { tts_speed } : {}),
    tts_provider,
    ...(irodori_base_url !== undefined ? { irodori_base_url } : {}),
    ...(typeof irodori_speaker === "string" ? { irodori_speaker } : {}),
    ...(irodori_voices !== undefined ? { irodori_voices } : {}),
    ...(typeof irodori_num_steps === "number" ? { irodori_num_steps } : {}),
    ...(typeof raw.irodori_cfg_scale_text === "number"
      ? { irodori_cfg_scale_text: raw.irodori_cfg_scale_text }
      : {}),
    ...(typeof raw.irodori_cfg_scale_speaker === "number"
      ? { irodori_cfg_scale_speaker: raw.irodori_cfg_scale_speaker }
      : {}),
    ...(typeof raw.irodori_seconds === "number" ? { irodori_seconds: raw.irodori_seconds } : {}),
    ...(typeof tts_max_inflight === "number" ? { tts_max_inflight } : {}),
    ...(broker_base_url ? { broker_base_url } : {}),
    ...(typeof chat_model_context_window === "number" ? { chat_model_context_window } : {}),
  };
}
