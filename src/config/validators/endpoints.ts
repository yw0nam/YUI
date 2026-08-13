import type { EndpointsConfig } from "../../contract";
import { resolveTtsProviderKind } from "../../io/tts-provider";
import { assertValid, ConfigError, isObject } from "./shared";

/** 미설정 판정 — 키가 없거나 빈 문자열이면 그 기능은 꺼진 것으로 본다. */
function unset(v: unknown): boolean {
  return v === undefined || v === "";
}

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
  // 서비스 URL은 선택 — 미설정이면 해당 기능 off. 값이 있으면 http(s)여야 함.
  const optHttpUrl = (k: string): string => (unset(raw[k]) ? "" : httpUrl(k));
  const chat_base_url = optHttpUrl("chat_base_url");
  const stt_base_url = optHttpUrl("stt_base_url");
  const tts_base_url = optHttpUrl("tts_base_url");
  // 선택 — 미설정이면 빈 값. 값이 있으면 "/v1/responses" 같은 경로만 허용하고,
  // "//host"(protocol-relative)는 base_url과 합쳐도 경로로 동작하지 않으므로 거부한다.
  const rawChatEndpoint = raw.chat_endpoint;
  if (
    !unset(rawChatEndpoint) &&
    (typeof rawChatEndpoint !== "string" ||
      !rawChatEndpoint.startsWith("/") ||
      rawChatEndpoint.startsWith("//"))
  ) {
    issues.push(
      `chat_endpoint는 "/"로 시작하는 경로여야 함 (받음: ${JSON.stringify(rawChatEndpoint)})`,
    );
  }
  const chat_endpoint = typeof rawChatEndpoint === "string" ? rawChatEndpoint : "";
  // chat_model: optional. If present, must be a non-empty string (model ID is config's concern).
  const chat_model = raw.chat_model;
  if (chat_model !== undefined && (typeof chat_model !== "string" || chat_model.trim() === "")) {
    issues.push(`chat_model은 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(chat_model)})`);
  }
  // chat_instructions: optional. If present, must be a string (Responses `instructions` nudge, config's concern).
  const chat_instructions = raw.chat_instructions;
  if (chat_instructions !== undefined && typeof chat_instructions !== "string") {
    issues.push(`chat_instructions는 문자열이어야 함 (받음: ${JSON.stringify(chat_instructions)})`);
  }
  // chat_api: optional enum. When set, only "responses"|"chat_completions" allowed; omitted when unset (upstream default).
  const rawChatApi = raw.chat_api;
  if (rawChatApi !== undefined && rawChatApi !== "responses" && rawChatApi !== "chat_completions") {
    issues.push(
      `chat_api는 "responses" | "chat_completions" 중 하나여야 함 (받음: ${JSON.stringify(rawChatApi)})`,
    );
  }
  const chat_api: EndpointsConfig["chat_api"] =
    rawChatApi === "responses" || rawChatApi === "chat_completions" ? rawChatApi : undefined;
  // tts_model / tts_voice: optional. TTS service default when unset.
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
  // tts_provider: optional enum. Empty resolves like unset — openai, the neutral provider, which
  // requires no extra fields (the resolved value is written to the output).
  const rawProvider = raw.tts_provider;
  if (!unset(rawProvider) && rawProvider !== "openai" && rawProvider !== "irodori") {
    issues.push(
      `tts_provider는 "openai" | "irodori" 중 하나여야 함 (받음: ${JSON.stringify(rawProvider)})`,
    );
  }
  const tts_provider: EndpointsConfig["tts_provider"] = resolveTtsProviderKind(
    typeof rawProvider === "string" ? rawProvider : undefined,
  );

  // When provider=irodori, base_url (http url) + speaker (non-empty) are required — bare config fail-loud.
  let irodori_base_url: string | undefined;
  if (!unset(raw.irodori_base_url) || tts_provider === "irodori") {
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

  // irodori_num_steps: optional, integer ≥ 1.
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
  // irodori_cfg_scale_text / _speaker / seconds: optional, finite number > 0.
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
  // broker_base_url: optional. If set, must be an http(s) URL (Expression Broker MCP endpoint).
  let broker_base_url: string | undefined;
  if (!unset(raw.broker_base_url)) {
    broker_base_url = httpUrl("broker_base_url");
  }
  // tts_max_inflight: optional, integer ≥ 1.
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
  // chat_model_context_window: optional, finite number > 0. undefined when unset.
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
    chat_endpoint,
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
