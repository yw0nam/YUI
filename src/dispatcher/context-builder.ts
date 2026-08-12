import type { BodyState, ClientContext, InputContext, TriggerMeta } from "../contract";
import type { BusEnvelope } from "./event-bus";

interface ContextProviders {
  getScreenshot?: () => Promise<InputContext["screenshot"] | undefined>;
  onScreenshotError?: (error: unknown) => void;
  getBodyState?: () => BodyState | undefined;
}

export interface BuiltContext {
  ctx: InputContext;
  clientContext: ClientContext;
}

function userTextOf(env: BusEnvelope): string | undefined {
  const text = env.payload?.text;
  return typeof text === "string" ? text : undefined;
}

function userImagesOf(env: BusEnvelope): string[] | undefined {
  const images = env.payload?.images;
  return Array.isArray(images) && images.every((url) => typeof url === "string")
    ? (images as string[])
    : undefined;
}

function agentOf(env: BusEnvelope): TriggerMeta["agent"] | undefined {
  if (env.event_name !== "agent.done" && env.event_name !== "agent.needs_input") return undefined;
  const payload = env.payload;
  if (
    typeof payload?.tool !== "string" ||
    typeof payload?.project !== "string" ||
    typeof payload?.cwd !== "string" ||
    (payload?.phase !== "done" && payload?.phase !== "needs_input") ||
    typeof payload?.summary !== "string" ||
    typeof payload?.ts !== "number"
  ) {
    return undefined;
  }
  return {
    tool: payload.tool,
    project: payload.project,
    cwd: payload.cwd,
    ...(payload.status === "success" || payload.status === "error"
      ? { status: payload.status }
      : {}),
    phase: payload.phase,
    ...(typeof payload.session_id === "string" ? { session_id: payload.session_id } : {}),
    ...(typeof payload.detail === "string" ? { detail: payload.detail } : {}),
    summary: payload.summary,
    ts: payload.ts,
  };
}

function agentCatchupOf(env: BusEnvelope): TriggerMeta["agent_catchup"] | undefined {
  if (env.event_name !== "agent.catchup") return undefined;
  const count = env.payload?.count;
  const items = env.payload?.items;
  if (typeof count !== "number" || !Array.isArray(items)) return undefined;
  const valid = items.every((raw) => {
    const item = raw as Record<string, unknown>;
    return (
      item != null &&
      typeof item.tool === "string" &&
      typeof item.project === "string" &&
      (item.phase === "done" || item.phase === "needs_input") &&
      typeof item.summary === "string" &&
      typeof item.ts === "number"
    );
  });
  if (!valid) return undefined;
  return {
    count,
    items: (items as Array<Record<string, unknown>>).map((item) => ({
      tool: item.tool as string,
      project: item.project as string,
      ...(item.status === "success" || item.status === "error"
        ? { status: item.status as "success" | "error" }
        : {}),
      phase: item.phase as "done" | "needs_input",
      ...(typeof item.session_id === "string" ? { session_id: item.session_id as string } : {}),
      ...(typeof item.detail === "string" ? { detail: item.detail as string } : {}),
      summary: item.summary as string,
      ts: item.ts as number,
    })),
  };
}

function signalsOf(env: BusEnvelope): TriggerMeta["signals"] | undefined {
  if (!env.event_name.startsWith("signals.") && env.event_name !== "proactive.tap_bored") {
    return undefined;
  }
  const signals = env.payload?.signals;
  return Array.isArray(signals) ? (signals as TriggerMeta["signals"]) : undefined;
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function localIso(ts: number, timeZone: string): string {
  const date = new Date(ts);
  try {
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(date)
      .replace(" ", "T");
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;
    const offset =
      name && name !== "GMT" && name !== "UTC" ? name.replace(/^(?:GMT|UTC)/, "") : "+00:00";
    return `${local}${offset}`;
  } catch {
    return date.toISOString();
  }
}

function triggerKind(eventName: string): TriggerMeta["kind"] {
  if (eventName.startsWith("schedule.")) return "schedule";
  if (eventName.startsWith("proactive.")) return "proactive";
  if (eventName.startsWith("agent.")) return "agent";
  if (eventName.startsWith("signals.")) return "signals";
  return "user";
}

export function buildClientContext(
  ctx: InputContext,
  env: BusEnvelope,
  bodyState?: BodyState,
): ClientContext {
  const payload = env.payload;
  const cue =
    typeof payload?.cue_id === "string" && typeof payload?.label === "string"
      ? {
          label: payload.label,
          ...(typeof payload.context === "string" ? { context: payload.context } : {}),
          ...(typeof payload.local_time === "string" ? { local_time: payload.local_time } : {}),
          ...(typeof payload.idle_min === "number" ? { idle_min: payload.idle_min } : {}),
        }
      : undefined;
  const gapMs = typeof payload?.gap_ms === "number" ? payload.gap_ms : undefined;
  const agent = agentOf(env);
  const agentCatchup = agentCatchupOf(env);
  const signals = signalsOf(env);
  const screenshot = ctx.screenshot
    ? { enabled: ctx.screenshot.enabled, source: ctx.screenshot.source }
    : undefined;

  return {
    env: ctx.env,
    ...(screenshot ? { screenshot } : {}),
    ...(bodyState ? { body_state: bodyState } : {}),
    trigger: {
      kind: triggerKind(env.event_name),
      ...(cue ? { cue } : {}),
      ...(gapMs != null ? { idle_elapsed_min: Math.round(gapMs / 60_000) } : {}),
      ...(agent ? { agent } : {}),
      ...(agentCatchup ? { agent_catchup: agentCatchup } : {}),
      ...(signals ? { signals } : {}),
    },
  };
}

export async function buildContext(
  env: BusEnvelope,
  providers: ContextProviders,
): Promise<BuiltContext> {
  const timezone = resolveTimezone();
  const userText = userTextOf(env);
  const userImages = userImagesOf(env);
  const ctx: InputContext = {
    ...(userText !== undefined ? { user_text: userText } : {}),
    ...(userImages?.length ? { user_images: userImages } : {}),
    env: {
      timestamp: localIso(env.ts, timezone),
      timezone,
    },
  };

  if (providers.getScreenshot) {
    try {
      const screenshot = await providers.getScreenshot();
      if (screenshot) ctx.screenshot = screenshot;
    } catch (error) {
      providers.onScreenshotError?.(error);
    }
  }

  return {
    ctx,
    clientContext: buildClientContext(ctx, env, providers.getBodyState?.()),
  };
}

export function imageDataUrlsOf(ctx: InputContext): string[] {
  return [
    ...(ctx.screenshot?.data_url ? [ctx.screenshot.data_url] : []),
    ...(ctx.user_images ?? []),
  ];
}
