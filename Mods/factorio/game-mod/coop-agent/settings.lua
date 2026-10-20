data:extend({
  {
    type = "string-setting",
    name = "coop-agent-body-name",
    setting_type = "runtime-global",
    default_value = "Buddy",
    order = "a",
  },
  {
    type = "bool-setting",
    name = "coop-agent-body-enabled",
    setting_type = "runtime-global",
    default_value = false,
    order = "b",
  },
  {
    type = "string-setting",
    name = "coop-agent-body-prototype",
    setting_type = "runtime-global",
    default_value = "character",
    order = "c",
  },
  {
    type = "string-setting",
    name = "coop-agent-body-color",
    setting_type = "runtime-global",
    default_value = "orange",
    allowed_values = { "orange", "red", "yellow", "green", "cyan", "blue", "purple", "white" },
    order = "d",
  },
  {
    type = "string-setting",
    name = "coop-agent-idle-start",
    setting_type = "runtime-global",
    default_value = "follow",
    allowed_values = { "follow", "stay" },
    order = "e",
  },
})
