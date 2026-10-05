/** A single selectable VRM (model-swap manifest entry). */
export interface AvatarOption {
  /** Stable key (e.g. "carlotta"). Used to persist selection state. */
  id: string;
  /** Display name (e.g. "Carlotta"). */
  label: string;
  /** Same meaning as vrm_url — vite path or absolute URL. */
  url: string;
  /** "user" = imported via the OS file picker, "file" = external path declared in the config file. Unknown when unset. */
  source?: "bundled" | "file" | "user";
}

export interface TapConfig {
  spam_count: number;
  spam_window_ms: number;
  region_radius_frac: number;
  region_motions: { head: string; chest: string; hips: string };
  bored_cue: { label: string; context?: string };
  /** Emotion applied alongside the region motion. Absent region → motion only. */
  region_emotions?: { head?: string; chest?: string; hips?: string };
  /** Touch speech cue handed to the backend on a region tap. Absent region → no candidate. */
  region_cues?: {
    head?: { label: string; context?: string };
    chest?: { label: string; context?: string };
    hips?: { label: string; context?: string };
  };
  /** Cooldown (ms) shared by all touch speech candidates. */
  touch_cue_cooldown_ms: number;
  /** Hold (ms) before a region-tap emotion eases back to neutral. */
  touch_emotion_hold_ms: number;
  /** Press duration (ms) on the head region before a tap becomes a pat. */
  pat_hold_ms: number;
}

export interface PeekConfig {
  side_out_frac: number;
  side_in_frac: number;
  inset_frac: number;
  mirror_side: "left" | "right" | "none";
}

/** Ambient floor-stroll knobs. Distances and the floor tolerance are logical px. */
export interface WalkConfig {
  /** Shortest gap between stroll attempts. */
  interval_min_ms: number;
  /** Longest gap between stroll attempts. */
  interval_max_ms: number;
  /** Shortest stroll, before work-area clamping. */
  distance_min_px: number;
  /** Longest stroll, before work-area clamping. */
  distance_max_px: number;
  /** How far the window bottom may sit from the work-area bottom and still count as grounded. */
  floor_tolerance_px: number;
}

/** Ambient stroll knobs for a drag-origin window-top perch. */
export interface PerchWalkConfig {
  dwell_min_ms: number;
  dwell_max_ms: number;
  distance_min_px: number;
  distance_max_px: number;
  edge_margin_frac: number;
  /** Height difference within which a neighbouring window top is one ledge with the host's. */
  level_tolerance_px: number;
}

/** Fall dynamics and the surfaces a fall stops on. Distances and speeds are logical px. */
export interface FallConfig {
  /** Downward acceleration while the character falls. */
  gravity_px_s2: number;
  /** Terminal velocity the descent never exceeds. */
  max_speed_px_s: number;
  /** A drop shorter than this fraction of the on-screen character height snaps instead of falling. */
  min_drop_frac: number;
  /** Cooldown (ms) between drop speech candidates. */
  cue_cooldown_ms: number;
  /** Standing room either side of the fall a window top needs to catch it, in character widths. */
  land_room_frac: number;
  /** Chance a perched stroll with no jumpable neighbour walks off the edge instead. */
  step_off_probability: number;
}

export interface DescendConfig {
  /** Chance a stroll on a segment with a descent edge walks to that edge and descends. */
  chance: number;
  /** Chance the descent climbs down the lower screen's edge; otherwise she steps off and falls. */
  climb_down_chance: number;
}

/** Ambient window-climb knobs. Fractions are multiples of the on-screen character height. */
export interface ClimbConfig {
  /** Shortest gap between climb attempts. */
  interval_min_ms: number;
  /** Longest gap between climb attempts. */
  interval_max_ms: number;
  /** Shortest sit before the character climbs back down. */
  perch_dwell_min_ms: number;
  /** Longest sit before the character climbs back down. */
  perch_dwell_max_ms: number;
  /** Tallest climbable window, as a multiple of the character height. */
  max_height_frac: number;
  /** How far the character drops onto the wall during the hang transition. */
  hang_frac: number;
  /**
   * Hand reach off the wall on the way up: how far outside a window's face the character
   * stands to climb it, so the body clears the edge instead of straddling it. Twice this
   * is the width of the column beside the edge that must be clear of windows in front.
   */
  wall_offset_frac: number;
  /** The same reach on the way down; the descent clips hang the body further off the wall. */
  descent_wall_offset_frac: number;
  /** Shortest walk in along the window's top edge before she sits, from the corner. */
  ledge_walk_min_frac: number;
  /** Longest such walk. Clamped at run time to keep the seat on the window. */
  ledge_walk_max_frac: number;
}

/** Window-to-window jump knobs. Height fractions are multiples of the character height. */
export interface JumpConfig {
  /** Chance a planned perch stroll becomes a jump when an eligible neighbour exists. */
  probability: number;
  /** How far above the host's top a neighbour's top may sit and still be reachable. */
  height_up_max_frac: number;
  /** How far below it. */
  height_down_max_frac: number;
  /** Widest gap she will clear, as a multiple of the character's own width. */
  gap_max_width_frac: number;
  /** How far above the higher of the two tops the arc peaks. */
  apex_lift_frac: number;
  /** Point in the clip where the feet leave the host, as a fraction of its length. */
  takeoff_frac: number;
  /** Point in the clip where they reach the neighbour. */
  land_frac: number;
  /**
   * How long a flight may run before it is abandoned. The clip paces the arc, so a clip
   * that never becomes measurable would otherwise leave her hanging for good.
   */
  flight_timeout_ms: number;
}

/** Authored label for one reflex-gesture speech candidate. context is optional user-authored intent. */
export interface GestureCueConfig {
  label: string;
  context?: string;
}

/** Reflex-gesture speech cues — drag-hold / window-sit / peek / drop. */
export interface GestureCuesConfig {
  drag_held: GestureCueConfig;
  window_sit: GestureCueConfig;
  peek: GestureCueConfig;
  dropped: GestureCueConfig;
}

/** Vertical band of the model box, as fractions of its height measured from the feet. */
export interface FitBandConfig {
  from_frac: number;
  to_frac: number;
}

/** Full-body fit-to-bounds camera knob. */
export interface FramingConfig {
  /** Padding around the model bounds, as a fraction of the fitted size. */
  margin: number;
  /** Vertical field of view (degrees) the fit solves against. */
  fov: number;
  /** The band the phone frames by height, with the orbit pivot at its centre. */
  upper_body: FitBandConfig;
}

/** Click-through hit-test knob. */
export interface HitTestKnobs {
  /** How far outside the character the cursor may sit and still hold the window interactive. */
  hysteresis_margin_px: number;
  /** Gap between cursor reads while the window is click-through. */
  poll_interval_ms: number;
  /** Agreeing samples needed before the click-through state flips. */
  debounce_samples: number;
  /** Alpha (0, 1] a rendered pixel must reach to count as the character. */
  alpha_threshold: number;
}

/** Cursor gaze-tracking angles (degrees) and damping. */
export interface GazeKnobs {
  /** No tracking within this eccentricity (degrees). */
  deadDeg: number;
  /** Eyes reach full tracking by here; head starts recruiting past it (degrees). */
  headEngageDeg: number;
  /** Beyond this the character disengages — can't crane the neck around (degrees). */
  disengageDeg: number;
  /** Degrees of gaze rotation per window-width of cursor offset from the head's screen position. */
  sensitivity: number;
  /** Max head-bone yaw (degrees). */
  maxHeadYaw: number;
  /** Max head-bone pitch (degrees). */
  maxHeadPitch: number;
  /** Max eye yaw/pitch (degrees). */
  eyeMaxDeg: number;
  /** Fraction of the head rotation taken by the head bone; the rest goes to neck. */
  headNeckSplit: number;
  /** Exponential damping rate (1/s) for k = 1-exp(-smooth·dt). */
  smooth: number;
}

/** configs/avatar.json — VRM to load (renderer input). */
export interface AvatarConfig {
  /** vite dev static-serving path (`/vrms/*.vrm`) or absolute URL. Default selection. */
  vrm_url: string;
  /** List of selectable VRMs. Absent → vrm_url is the single model. */
  available?: AvatarOption[];
  /** Full-body fit-to-bounds camera knob. */
  framing: FramingConfig;
  /** Click-through hit-test knob. */
  hit_test: HitTestKnobs;
  /** Tap reaction knobs. */
  tap: TapConfig;
  /** Side-peek geometry and mirroring knobs. */
  peek: PeekConfig;
  /** Ambient floor-stroll knobs. */
  walk: WalkConfig;
  /** Ambient stroll knobs for a drag-origin window-top perch. */
  perch_walk: PerchWalkConfig;
  /** Drag-release fall knobs. */
  fall: FallConfig;
  /** Upper-to-lower monitor descent choices. */
  descend: DescendConfig;
  /** Ambient window-climb knobs. */
  climb: ClimbConfig;
  /** Window-to-window jump knobs. */
  jump: JumpConfig;
  /** Drag-hold reflex threshold (ms) — proactive.drag_held fires once a drag has been held this long. */
  drag_hold_ms: number;
  /** Reflex-gesture speech cues (drag-hold / window-sit / peek / drop). */
  gesture_cues: GestureCuesConfig;
  /** Cursor gaze-tracking knob. */
  gaze: GazeKnobs;
}
