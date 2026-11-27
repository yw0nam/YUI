/**
 * Renders a ClientContext into the compact `key: value` plain-line prompt block sent to the
 * backend. The block is prose for the model inside the user message. A backend integration in
 * this repository reads the word after `trigger:` on the headline and the whole
 * `trigger: user message` line with its idle clause, so those shapes stay stable.
 */

import type { ClientContext, TriggerMeta, TurnEnded } from "../../contract";
import { oneLine } from "../../io/chat/one-line";
import { renderGuideBlock } from "../../io/guide/guide-docs";
import { clockOf } from "../../settings/rest/rest-end";

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

function renderDoNotDisturb(
  dnd: ClientContext["do_not_disturb"],
  nowMs: number,
): string | undefined {
  if (!dnd) return undefined;
  const age = dnd.since === undefined ? "" : ` (for ${minutesSince(dnd.since, nowMs)}min)`;
  const ends = (subject: string) =>
    dnd.ends_local ? `; ${subject} ends at ${dnd.ends_local} local` : "";
  if (dnd.kind === "off_span")
    return `do not disturb: an active-hours off span holds the character's own turns${ends("it")}`;
  if (dnd.kind === "focus")
    return `do not disturb: the character is in a focus session the user started${age}${ends("it")}`;
  return `do not disturb: the character is resting at the user's request${age}${ends("the rest")}`;
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

const pad = (value: number): string => String(value).padStart(2, "0");

/** Local wall-clock `YYYY-MM-DD HH:MM`, the `time:` line's format without seconds. */
function localStamp(atMs: number): string {
  const date = new Date(atMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `last together:` only on the day's first activity, and only when a presence was recorded before it. */
function lastTogetherOf(
  m: NonNullable<TriggerMeta["milestone"]>,
  nowMs: number,
): string | undefined {
  if (m.name !== "first_activity" || m.last_together == null) return undefined;
  return `last together: ${localStamp(m.last_together)} (${ageOf(m.last_together, nowMs)})`;
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

function renderThreadsAttached(threads: ClientContext["threads_attached"]): string[] {
  if (!threads?.length) return [];
  const rows = threads.map((t) => `  ${[t.id, t.source, t.title].map(oneLine).join(" | ")}`);
  return ["threads attached:", ...rows];
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

function screenBody(s: NonNullable<TriggerMeta["screen"]>): string {
  const left =
    s.from_app && s.from_dwell_min != null
      ? `left ${oneLine(s.from_app)} after ${s.from_dwell_min}min and `
      : "";
  return `screen ${s.transition}; the user ${left}has been in the frontmost app for ${s.dwell_min}min`;
}

function cueBody(kind: TriggerMeta["kind"], cue: NonNullable<TriggerMeta["cue"]>): string {
  return `${kind} cue "${oneLine(cue.label)}"`;
}

function milestoneBody(m: NonNullable<TriggerMeta["milestone"]>): string {
  return `milestone ${oneLine(m.name)}`;
}

function addressedBody(a: NonNullable<TriggerMeta["addressed"]>): string {
  return a.user_message !== undefined
    ? `handed over by ${oneLine(a.from)}: the user said "${oneLine(a.user_message)}"; ${oneLine(a.from)} said "${oneLine(a.text)}"`
    : `addressed by ${oneLine(a.from)}: "${oneLine(a.text)}"`;
}

function waitedLine(item: NonNullable<TriggerMeta["waited"]>[number], nowMs: number): string {
  const body = item.screen
    ? screenBody(item.screen)
    : item.cue
      ? cueBody(item.kind, item.cue)
      : item.milestone
        ? milestoneBody(item.milestone)
        : item.addressed
          ? addressedBody(item.addressed)
          : item.kind;
  return `waited: ${clockOf(item.at)} local, ${ageOf(item.at, nowMs)}: ${body}`;
}

function renderTrigger(trigger: TriggerMeta, nowMs: number): string[] {
  const lines: string[] = [];
  const idleClause =
    trigger.idle_elapsed_min != null
      ? ` (the user has been idle for ${trigger.idle_elapsed_min}min)`
      : "";
  // A bundle's top member carries its own wait; an addressed headline already carries an age.
  const waitedAge =
    trigger.at != null && trigger.kind !== "user" && trigger.kind !== "addressed"
      ? ` (${ageOf(trigger.at, nowMs)})`
      : "";

  if (trigger.screen) {
    lines.push(`trigger: ${screenBody(trigger.screen)}${waitedAge}`);
  } else if (trigger.cue) {
    lines.push(`trigger: ${cueBody(trigger.kind, trigger.cue)}${idleClause}${waitedAge}`);
    if (trigger.cue.context) {
      lines.push(`cue note (the user's own intent for this cue): ${oneLine(trigger.cue.context)}`);
    }
  } else if (trigger.milestone) {
    lines.push(
      `trigger: ${milestoneBody(trigger.milestone)} (fired at ${oneLine(trigger.milestone.local_time)})${waitedAge}`,
    );
    const lastTogether = lastTogetherOf(trigger.milestone, nowMs);
    if (lastTogether) lines.push(lastTogether);
  } else if (trigger.addressed) {
    lines.push(
      `trigger: ${addressedBody(trigger.addressed)} (${minutesSince(trigger.addressed.ts, nowMs)}min ago)`,
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
    lines.push(`trigger: ${trigger.kind}${idleClause}${waitedAge}`);
  }

  for (const item of trigger.waited ?? []) lines.push(waitedLine(item, nowMs));

  if (trigger.signals) {
    for (const group of trigger.signals) {
      const envelope = group.envelope;
      const prefix = `signal [${oneLine(envelope.source)}/${oneLine(envelope.event_type)} @${clockOf(envelope.occurred_at)} local, ${ageOf(envelope.occurred_at, nowMs)}, id ${oneLine(envelope.event_id)}]:`;
      if (group.items.length === 0) {
        lines.push(`${prefix} (no payload)`);
      } else {
        for (const item of group.items) lines.push(`${prefix} ${oneLine(JSON.stringify(item))}`);
      }
    }
  }

  return lines;
}

export function renderClientContext(clientContext: ClientContext, nowMs: number): string {
  const lines: string[] = [`time: ${clientContext.env.timestamp} (${clientContext.env.timezone})`];

  const frontmost = renderFrontmost(clientContext.env.frontmost, nowMs);
  if (frontmost) lines.push(frontmost);

  const dnd = renderDoNotDisturb(clientContext.do_not_disturb, nowMs);
  if (dnd) lines.push(dnd);

  const screenshot = renderScreenshot(clientContext.screenshot);
  if (screenshot) lines.push(screenshot);

  const body = renderBody(clientContext.body_state, nowMs);
  if (body) lines.push(body);

  lines.push(...renderRelations(clientContext.relations, nowMs));

  const openCharacters = renderOpenCharacters(clientContext.open_characters);
  if (openCharacters) lines.push(openCharacters);

  const threads = renderThreadsWaiting(clientContext.threads_waiting);
  if (threads) lines.push(threads);

  lines.push(...renderThreadsAttached(clientContext.threads_attached));

  const tools = renderToolSwitches(clientContext.tool_switches);
  if (tools) lines.push(tools);

  const previous = renderPrevious(clientContext.previous, nowMs);
  if (previous) lines.push(previous);

  lines.push(...renderOverheard(clientContext.overheard, nowMs));

  lines.push(...renderTrigger(clientContext.trigger, nowMs));

  if (clientContext.trigger.guide) lines.push(renderGuideBlock(clientContext.trigger.guide));

  return lines.join("\n");
}
