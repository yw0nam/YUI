---
name: yui-daily-briefing
description: "Speak the first-activity daily briefing from the signal items whose skill field names this skill. Use on a milestone first_activity turn that carries daily_briefing signals, and on follow-up questions about an item in that briefing."
license: PolyForm-Noncommercial-1.0.0
---

# yui-daily-briefing

Runtime skill for the selected YUI backend. Input: the `signal` lines of the current turn whose item carries `"skill": "yui-daily-briefing"`. Output: the spoken briefing with a markdown link per mentioned item, or empty output when there is nothing new.
