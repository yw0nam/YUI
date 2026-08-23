/**
 * Renders a ClientContext into the compact `key: value` plain-line prompt block sent to the
 * backend (replaces the JSON-serialized form). This is prompt text inside the user message —
 * nothing parses it programmatically, so the shape only needs to stay stable and readable to a
 * model, not machine-parseable.
 */

import type { ClientContext, TriggerMeta } from "../contract";

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
    return `screenshot: monitor ${source.index}${label}`;
  }
  if (source.kind === "browser_tab") {
    const url = source.url ? ` (${oneLine(source.url)})` : "";
    return `screenshot: browser_tab ${oneLine(source.browser)} — "${oneLine(source.tab_title)}"${url}`;
  }
  return `screenshot: window ${oneLine(source.app)} — "${oneLine(source.window_title)}"`;
}

function renderBody(bodyState: ClientContext["body_state"], nowMs: number): string | undefined {
  if (!bodyState) return undefined;
  const perchedOn = bodyState.posture.perched_on;
  const onLabel = perchedOn?.app ?? perchedOn?.window_title;
  const on = onLabel ? ` on ${oneLine(onLabel)}` : "";
  const mins = minutesSince(bodyState.since, nowMs);
  return `body: ${bodyState.posture.state}${on} (for ${mins}min)`;
}

function renderTrigger(trigger: TriggerMeta, nowMs: number): string[] {
  const lines: string[] = [];
  const idleClause =
    trigger.idle_elapsed_min != null ? ` (user idle ${trigger.idle_elapsed_min}min)` : "";

  if (trigger.screen) {
    const s = trigger.screen;
    const left =
      s.from_app && s.from_dwell_min != null
        ? `, left ${oneLine(s.from_app)} after ${s.from_dwell_min}min`
        : "";
    lines.push(`trigger: screen ${s.transition}${left}, in current app ${s.dwell_min}min`);
    if (s.recent && s.recent.length > 0) {
      const path = s.recent
        .map((e) => `${oneLine(e.from_app)} ${e.dwell_min}min -> ${oneLine(e.to_app)}`)
        .join(", ");
      lines.push(`recent: ${path}`);
    }
  } else if (trigger.cue) {
    lines.push(`trigger: ${trigger.kind} "${oneLine(trigger.cue.label)}"${idleClause}`);
    if (trigger.cue.context) lines.push(`cue note: ${oneLine(trigger.cue.context)}`);
  } else if (trigger.agent) {
    const a = trigger.agent;
    const status = a.status ? ` (${a.status})` : "";
    const ago = ` (${minutesSince(a.ts, nowMs)}min ago)`;
    lines.push(
      `trigger: agent ${oneLine(a.tool)} ${a.phase}${status}, project "${oneLine(a.project)}"${ago}`,
    );
    if (a.summary) lines.push(`agent note: ${oneLine(a.summary)}`);
    if (a.detail) lines.push(`agent detail: ${oneLine(a.detail)}`);
  } else if (trigger.agent_catchup) {
    const ac = trigger.agent_catchup;
    lines.push(`trigger: agent catchup (${ac.count} events)`);
    for (const item of ac.items) {
      const status = item.status ? ` (${item.status})` : "";
      const summary = item.summary ? ` - "${oneLine(item.summary)}"` : "";
      const ago = ` (${minutesSince(item.ts, nowMs)}min ago)`;
      lines.push(
        `agent event: ${oneLine(item.tool)} ${item.phase}${status}, project "${oneLine(item.project)}"${summary}${ago}`,
      );
      if (item.detail) lines.push(`agent detail: ${oneLine(item.detail)}`);
    }
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

  if (trigger.signals) {
    for (const group of trigger.signals) {
      if (!group.envelope) {
        for (const item of group.items) lines.push(`signal: ${JSON.stringify(item)}`);
        continue;
      }
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

  const body = renderBody(clientContext.body_state, nowMs);
  if (body) lines.push(body);

  lines.push(...renderTrigger(clientContext.trigger, nowMs));

  return lines.join("\n");
}
