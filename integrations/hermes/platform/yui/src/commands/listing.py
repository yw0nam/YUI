"""Hermes built-ins offered as Backend commands."""

from hermes_cli.commands_platforms import _gateway_available_commands

EXCLUDED = frozenset(
    [
        "new",
        "stop",
        "start",
        "topic",
        "retry",
        "bg",
        "btw",
        "queue",
        "steer",
        "goal",
        "heartbeat",
        "refine",
        "review",
        "loop",
        "plan",
        "moa",
        "learn",
        "init",
        "blueprint",
    ]
)


def backend_commands() -> list[dict]:
    return [
        {"name": cmd.name, "description": cmd.describe()[:200], "args": cmd.args_hint[:200]}
        for cmd in _gateway_available_commands()
        if cmd.name not in EXCLUDED
    ][:100]
