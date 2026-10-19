-- The probe registry.
return {
  spawn = require("scripts.probes.spawn"),
  mining = require("scripts.probes.mining"),
  crafting = require("scripts.probes.crafting"),
  baseline = require("scripts.probes.baseline"),
  revive = require("scripts.probes.revive"),
  spill = require("scripts.probes.spill"),
}
