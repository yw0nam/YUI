/**
 * Renders a ClientContext into the compact `key: value` plain-line prompt block sent to the
 * backend. The block is prose for the model inside the user message. A backend integration in
 * this repository reads the word after `trigger:` on the headline and the whole
 * `trigger: user message` line with its idle clause, so those shapes stay stable.
 */

import type { ClientContext, TriggerMeta, TurnEnded } from "../../contract";
import { oneLine } from "../../io/chat/one-line";
import { renderGuideBlock } from "../../io/guide/guide-docs";

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

function renderBody(bodyState: ClientContext["body_state"], nowMs: number): string | undefined {
  if (!bodyState) return undefined;
  const perchedOn = bodyState.posture.perched_on;
  const onLabel = perchedOn?.app ?? perchedOn?.window_title;
  const on = onLabel ? ` on ${oneLine(onLabel)}` : "";
  const mins = minutesSince(bodyState.since, nowMs);
  return `body: ${bodyState.posture.state}${on} (for ${mins}min)`;
}

/** `Nmin ago` under an hour, `Nh ago` under a day, else `Nd ago`. */
function ageOf(atMs: number, nowMs: number): string {
  const mins = minutesSince(atMs, nowMs);
  if (mins < 60) return `${mins}min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(mins / 1440)}d ago`;
}

function renderRelations(relations: ClientContext["relations"], nowMs: number): string[] {
  return (relations ?? []).map(({ target, band, delta, why, at, note }) => {
    const summary = note ? `, "${oneLine(note)}"` : "";
    const last = why
      ? ` (last change ${delta > 0 ? "+" : ""}${delta}, ${ageOf(at, nowMs)}: "${oneLine(why)}")`
      : "";
    return `relation: toward ${oneLine(target)} ${band}${summary}${last}`;
  });
}

function renderOpenCharacters(names: ClientContext["open_characters"]): string | undefined {
  if (!names || names.length === 0) return undefined;
  return `open characters: ${names.map((name) => `"${oneLine(name)}"`).join(", ")}`;
}

function renderThreadsWaiting(threads: ClientContext["threads_waiting"]): string | undefined {
  if (!threads || threads.total <= 0) return undefined;
  const groups = threads.by_source.map((group) => `${oneLine(group.source)} ${group.count}`);
  return `threads: ${threads.total} waiting (${groups.join(", ")})`;
}

/** One plugin tool or skill as a `name — text` entry; the name alone when the text is empty. */
function pluginEntry(name: string, text: string): string {
  const label = oneLine(name);
  const detail = oneLine(text);
  return detail === "" ? label : `${label} — ${detail}`;
}

function renderPluginTools(tools: ClientContext["plugin_tools"]): string | undefined {
  if (!tools || tools.length === 0) return undefined;
  return `plugin tools: ${tools.map((tool) => pluginEntry(tool.name, tool.summary)).join(" · ")}`;
}

function renderPluginSkills(skills: ClientContext["plugin_skills"]): string | undefined {
  if (!skills || skills.length === 0) return undefined;
  return `plugin skills: ${skills.map((skill) => pluginEntry(skill.name, skill.description)).join(" · ")}`;
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
  } else if (trigger.milestone) {
    const m = trigger.milestone;
    lines.push(`trigger: milestone ${oneLine(m.name)} (fired at ${oneLine(m.local_time)})`);
  } else if (trigger.addressed) {
    const a = trigger.addressed;
    lines.push(
      a.user_message !== undefined
        ? `trigger: handed over by ${oneLine(a.from)}: the user said "${oneLine(a.user_message)}"; ${oneLine(a.from)} said "${oneLine(a.text)}" (${minutesSince(a.ts, nowMs)}min ago)`
        : `trigger: addressed by ${oneLine(a.from)}: "${oneLine(a.text)}" (${minutesSince(a.ts, nowMs)}min ago)`,
    );
  } else if (trigger.kind === "user") {
    const addressed =
      trigger.mention === "everyone"
        ? " (addressed to everyone)"
        : trigger.mention === "character"
          ? " (addressed to the character)"
          : "";
    lines.push(`trigger: user message${addressed}${idleClause}`);
  } else if (trigger.kind === "signals") {
    const count = trigger.signals?.reduce((total, group) => total + group.items.length, 0) ?? 0;
    lines.push(`trigger: signals (${count} signal${count === 1 ? "" : "s"})${idleClause}`);
  } else {
    // Fallback: kind without a matching structured field (e.g. a bare idle proactive turn
    // without a configured cue).
    lines.push(`trigger: ${trigger.kind}${idleClause}`);
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

  const body = renderBody(clientContext.body_state, nowMs);
  if (body) lines.push(body);

  lines.push(...renderRelations(clientContext.relations, nowMs));

  const openCharacters = renderOpenCharacters(clientContext.open_characters);
  if (openCharacters) lines.push(openCharacters);

  const threads = renderThreadsWaiting(clientContext.threads_waiting);
  if (threads) lines.push(threads);

  const tools = renderToolSwitches(clientContext.tool_switches);
  if (tools) lines.push(tools);

  const previous = renderPrevious(clientContext.previous, nowMs);
  if (previous) lines.push(previous);

  lines.push(...renderOverheard(clientContext.overheard, nowMs));

  lines.push(...renderTrigger(clientContext.trigger, nowMs));

  const pluginTools = renderPluginTools(clientContext.plugin_tools);
  if (pluginTools) lines.push(pluginTools);

  const pluginSkills = renderPluginSkills(clientContext.plugin_skills);
  if (pluginSkills) lines.push(pluginSkills);

  if (clientContext.trigger.guide) lines.push(renderGuideBlock(clientContext.trigger.guide));

  return lines.join("\n");
}
