# Skills

A skill teaches the agent behind a character a new job. Each skill is written as a `SKILL.md` that the agent reads when the job comes up.

Skills belong to the brain, not to the app. Install one in the agent you connected, such as [Hermes Agent](../integrations/hermes/README.md), for example by copying its folder into the agent's skills folder.

| Skill | What it teaches |
| --- | --- |
| [yui-daily-briefing](yui-daily-briefing/SKILL.md) | Speak a daily briefing on the first activity of the day or on request, and build the scheduled producers that write it. |
| [rimworld-companion](rimworld-companion/SKILL.md) | Watch a RimWorld colony beside the player, pick which events to bring up, and comment on how the colony is doing. |

Skills for a coding agent that extends YUI, such as building a plugin, ship in the `yui-dev` plugin ([Coding agents](../coding-agents/README.md)). For the plugin guide, see [Write a plugin](../docs/guide/write-a-plugin.md).
