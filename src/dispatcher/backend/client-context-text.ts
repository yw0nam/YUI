/**
 * Renders a ClientContext into the compact `key: value` plain-line prompt block sent to the
 * backend. The block is prose for the model inside the user message. A backend integration in
 * this repository reads the word after `trigger:` on the headline and the whole
 * `trigger: user message` line with its idle clause, so those shapes stay stable.
 */

import type { ClientContext, TriggerMeta, TurnEnded, WakeCause } from "../../contract";
import { renderGuideBlock } from "../../io/guide/guide-docs";

/** Collapses embedded newlines/whitespace runs to a single space and strips any
    `<client_context>`/`</client_context>` tag sequence, so a sampled or user-authored string can
    never inject an extra physical line or terminate the block early. */
function oneLine(s: string): string {
  return s
    .replace(/<\/?client_context>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `max(0, round((nowMs - sinceMs) / 60000))` — never negative, rendered as a bare integer. */
function minutesSince(sinceMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - sinceMs) / 60_000));
}

function renderFrontmost(
  frontmost: ClientContext["env"]["frontmost"],
  nowMs: number,
): string | undefined {
  if (!frontmost) return undefined;
  const mins = minutesSince(frontmost.since, nowMs);
  if (frontmost.app) {
    const title =
      frontmost.window_title && frontmost.window_title !== frontmost.app
        ? ` — "${oneLine(frontmost.window_title)}"`
        : "";
    return `frontmost: ${oneLine(frontmost.app)}${title} (for ${mins}min)`;
  }
  if (frontmost.window_title) {
    return `frontmost: ${oneLine(frontmost.window_title)} (for ${mins}min)`;
  }
  return undefined;
}

function renderScreenshot(screenshot: ClientContext["screenshot"]): string | undefined {
  if (!screenshot?.enabled) return undefined;
  const source = screenshot.source;
  if (source.kind === "monitor") {
    const label = source.label ? ` (${oneLine(source.label)})` : "";
    return `screenshot source: monitor ${source.index}${label}`;
  }
  if (source.kind === "browser_tab") {
    const url = source.url ? ` (${oneLine(source.url)})` : "";
    return `screenshot source: browser_tab ${oneLine(source.browser)} — "${oneLine(source.tab_title)}"${url}`;
  }
  return `screenshot source: window ${oneLine(source.app)} — "${oneLine(source.window_title)}"`;
}

function renderBody(
  bodyState: ClientContext["body_state"],
  waking: boolean,
  nowMs: number,
): string | undefined {
  if (!bodyState) return undefined;
  const perchedOn = bodyState.posture.perched_on;
  const onLabel = perchedOn?.app ?? perchedOn?.window_title;
  const on = onLabel ? ` on ${oneLine(onLabel)}` : "";
  const gettingUp = waking ? ", getting up now" : "";
  const mins = minutesSince(bodyState.since, nowMs);
  return `body: ${bodyState.posture.state}${on}${gettingUp} (for ${mins}min)`;
}

function renderToolSwitches(switches: ClientContext["tool_switches"]): string | undefined {
  if (!switches || switches.length === 0) return undefined;
  const entries = switches.map((entry) => `${oneLine(entry.id)}=${entry.on ? "on" : "off"}`);
  return `tool switches: ${entries.join(", ")}`;
}

const PREVIOUS_ENDED: Record<TurnEnded, string> = {
  complete: "finished speaking",
  interrupted: "was cut off mid-speech",
  failed: "failed before speaking",
};

function renderPrevious(previous: ClientContext["previous"], nowMs: number): string | undefined {
  if (!previous) return undefined;
  const parts = [
    previous.spoken ? `already spoken: "${oneLine(previous.spoken)}"` : "",
    previous.unspoken ? `never spoken: "${oneLine(previous.unspoken)}"` : "",
  ].filter(Boolean);
  const heard = parts.map((part) => `, ${part}`).join("");
  // The event bus's own name for the turn, which the trigger headline rewords.
  return `previous turn: the reply to ${oneLine(previous.event_name)} ${PREVIOUS_ENDED[previous.ended]} (${minutesSince(previous.ts, nowMs)}min ago)${heard}`;
}

function renderOverheard(overheard: ClientContext["overheard"], nowMs: number): string[] {
  return (overheard ?? []).flatMap(({ name, entries }) => {
    const speaker = oneLine(name);
    const last = entries.at(-1);
    if (!last) return [];
    const count = entries.length;
    const header = `overheard: ${speaker} ↔ user, ${count} line${count === 1 ? "" : "s"} (${minutesSince(last.ts, nowMs)}min ago)`;
    return [
      header,
      ...entries.map((e) => `  ${e.role === "user" ? "user" : speaker}: "${oneLine(e.text)}"`),
    ];
  });
}

function renderRecentSwitches(recent: NonNullable<TriggerMeta["screen"]>["recent"]): string[] {
  if (!recent || recent.length === 0) return [];
  const steps: string[] = [];
  recent.forEach((entry, index) => {
    const from = oneLine(entry.from_app);
    const previousTo = index > 0 ? oneLine(recent[index - 1]!.to_app) : undefined;
    if (previousTo !== undefined && previousTo !== from) steps.push(previousTo);
    steps.push(`${from} (${entry.dwell_min}min)`);
  });
  steps.push(oneLine(recent[recent.length - 1]!.to_app));
  return [`recent switches: ${steps.join(" then ")}`];
}

const WOKEN_BY: Record<WakeCause, string> = {
  click: "the user's click",
  timeout: "the wake timeout",
  message: "this message",
};

function agentDetail(detail: string): string {
  return `agent detail (quoted from the coding agent): "${oneLine(detail)}"`;
}

function renderTrigger(trigger: TriggerMeta, nowMs: number): string[] {
  const lines: string[] = [];
  const idleClause =
    trigger.idle_elapsed_min != null
      ? ` (the user has been idle for ${trigger.idle_elapsed_min}min)`
      : "";

  if (trigger.screen) {
    const s = trigger.screen;
    const left =
      s.from_app && s.from_dwell_min != null
        ? `left ${oneLine(s.from_app)} after ${s.from_dwell_min}min and `
        : "";
    lines.push(
      `trigger: screen ${s.transition}; the user ${left}has been in the frontmost app for ${s.dwell_min}min`,
    );
    lines.push(...renderRecentSwitches(s.recent));
  } else if (trigger.cue) {
    lines.push(`trigger: ${trigger.kind} cue "${oneLine(trigger.cue.label)}"${idleClause}`);
    if (trigger.cue.context) {
      lines.push(`cue note (the user's own intent for this cue): ${oneLine(trigger.cue.context)}`);
    }
  } else if (trigger.agent) {
    const a = trigger.agent;
    const status = a.status ? ` (${a.status})` : "";
    const ago = ` (${minutesSince(a.ts, nowMs)}min ago)`;
    lines.push(
      `trigger: agent ${oneLine(a.tool)} ${a.phase}${status}, project "${oneLine(a.project)}"${ago}`,
    );
    if (a.summary) lines.push(`agent note (the coding agent's summary): "${oneLine(a.summary)}"`);
    if (a.detail) lines.push(agentDetail(a.detail));
  } else if (trigger.agent_catchup) {
    const ac = trigger.agent_catchup;
    lines.push(`trigger: agent catchup (${ac.count} event${ac.count === 1 ? "" : "s"})`);
    for (const item of ac.items) {
      const status = item.status ? ` (${item.status})` : "";
      const summary = item.summary ? ` - "${oneLine(item.summary)}"` : "";
      const ago = ` (${minutesSince(item.ts, nowMs)}min ago)`;
      lines.push(
        `agent event: ${oneLine(item.tool)} ${item.phase}${status}, project "${oneLine(item.project)}"${summary}${ago}`,
      );
      if (item.detail) lines.push(agentDetail(item.detail));
    }
  } else if (trigger.milestone) {
    const m = trigger.milestone;
    lines.push(`trigger: milestone ${oneLine(m.name)} (fired at ${oneLine(m.local_time)})`);
  } else if (trigger.wake && trigger.kind !== "user") {
    lines.push("trigger: wake");
  } else if (trigger.kind === "user") {
    lines.push(`trigger: user message${idleClause}`);
  } else if (trigger.kind === "signals") {
    const count = trigger.signals?.reduce((total, group) => total + group.items.length, 0) ?? 0;
    lines.push(`trigger: signals (${count} signal${count === 1 ? "" : "s"})${idleClause}`);
  } else {
    // Fallback: kind without a matching structured field (e.g. a malformed agent.* payload
    // that failed validation, or a bare idle proactive turn without a configured cue).
    lines.push(`trigger: ${trigger.kind}${idleClause}`);
  }

  if (trigger.wake) {
    lines.push(
      `wake: the character just woke from the bed, woken by ${WOKEN_BY[trigger.wake.cause]}`,
    );
  }

  if (trigger.signals) {
    for (const group of trigger.signals) {
      const envelope = group.envelope;
      const prefix = `signal [${oneLine(envelope.source)}/${oneLine(envelope.event_type)} @${new Date(envelope.occurred_at).toISOString()}, id ${oneLine(envelope.event_id)}]:`;
      if (group.items.length === 0) {
        lines.push(`${prefix} (no payload)`);
      } else {
        for (const item of group.items) lines.push(`${prefix} ${JSON.stringify(item)}`);
      }
    }
  }

  return lines;
}

export function renderClientContext(clientContext: ClientContext, nowMs: number): string {
  const lines: string[] = [`time: ${clientContext.env.timestamp} (${clientContext.env.timezone})`];

  const frontmost = renderFrontmost(clientContext.env.frontmost, nowMs);
  if (frontmost) lines.push(frontmost);

  const screenshot = renderScreenshot(clientContext.screenshot);
  if (screenshot) lines.push(screenshot);

  const body = renderBody(clientContext.body_state, Boolean(clientContext.trigger.wake), nowMs);
  if (body) lines.push(body);

  const tools = renderToolSwitches(clientContext.tool_switches);
  if (tools) lines.push(tools);

  const previous = renderPrevious(clientContext.previous, nowMs);
  if (previous) lines.push(previous);

  lines.push(...renderOverheard(clientContext.overheard, nowMs));

  lines.push(...renderTrigger(clientContext.trigger, nowMs));
  if (clientContext.trigger.guide) lines.push(renderGuideBlock(clientContext.trigger.guide));

  return lines.join("\n");
}
