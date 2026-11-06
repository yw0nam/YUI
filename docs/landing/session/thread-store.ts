import type { AskAnswer, Thread, ThreadsSnapshot } from "../../../src/contract";
import type { Recording } from "./recording";
export const store = (() => {
  const threads = new Map<string, Thread & { ask_prompt?: string }>(),
    listeners = new Set<(snapshot: ThreadsSnapshot) => void>();
  const answers = new Set<(prompt: string, answer: AskAnswer) => void>();
  let revision = 0,
    wall0 = 0,
    answerText: string | null = null;
  const publish = () => {
    const list = [...threads.values()]
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((th) => ({ ...th, entries: th.entries.map((e) => ({ ...e })) }));
    revision += 1;
    for (const l of listeners) l({ revision, threads: list });
  };
  return {
    subscribe(l: (snapshot: ThreadsSnapshot) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onAnswer(listener: (prompt: string, answer: AskAnswer) => void) {
      answers.add(listener);
    },
    begin(at: number) {
      wall0 = Date.now() - at * 1000;
    },
    fromRecording(s: Recording["snapshots"][number], firstAt: number) {
      threads.clear();
      for (const th of s.threads) {
        const abs = (ms: number) => wall0 + firstAt * 1000 + ms;
        const t = {
          ...th,
          created_at: abs(th.created_at),
          updated_at: abs(th.updated_at),
          entries: th.entries.map((e) => ({ ...e, at: abs(e.at) })),
        };
        if (answerText !== null) {
          const e = t.entries.find((x, i) => i > 0 && x.role === "user");
          if (e) e.text = answerText;
        }
        if (t.ask) t.ask = { ...t.ask, choices: t.ask.choices ?? [] };
        threads.set(t.id, t);
      }
      publish();
    },
    async answer(id: string, askId: string, ans: AskAnswer) {
      const th = threads.get(id);
      if (!th?.ask || th.ask.ask_id !== askId) throw new Error("the ask is closed");
      if (th.ask.prompt === "Allow Bash?" && ans.choice !== "allow" && ans.choice !== "deny")
        throw new Error("pick Allow or Deny in this demo");
      const labels = th.ask.choices
        .filter((c) => c.id === ans.choice || ans.choices?.includes(c.id))
        .map((c) => c.label);
      answerText = [...labels, ...(ans.text ? [ans.text] : [])].join("\n");
      th.ask_prompt = th.ask.prompt;
      delete th.ask;
      th.state = "working";
      th.updated_at = Date.now();
      th.entries.push({ role: "user", text: answerText, at: Date.now() });
      publish();
      for (const answer of answers) answer(th.ask_prompt, ans);
    },
    read(id: string) {
      const th = threads.get(id);
      if (th) {
        th.read = true;
        publish();
      }
    },
  };
})();
