/** Format a playback speed multiplier for display, e.g. 1.5 → "1.5x". */
function formatSpeed(v: number): string {
  const s = v.toFixed(2).replace(/\.?0+$/, "");
  return `${s}x`;
}

export interface MotionPreviewView {
  mount: HTMLElement;
  vrmMount: HTMLDivElement;
  registryList: HTMLDivElement;
  cbLoop: HTMLInputElement;
  slSpeed: HTMLInputElement;
  slFade: HTMLInputElement;
  selCrossfade: HTMLSelectElement;
  btnPlay: HTMLButtonElement;
  btnStop: HTMLButtonElement;
  btnIdle: HTMLButtonElement;
  statusNow: HTMLSpanElement;
  statusKind: HTMLSpanElement;
  statusPriority: HTMLSpanElement;
  statusElapsed: HTMLSpanElement;
  statusFps: HTMLSpanElement;
  viewportStatus: HTMLSpanElement;
  emotionList: HTMLDivElement;
  slIntensity: HTMLInputElement;
  slTransition: HTMLInputElement;
  btnNeutral: HTMLButtonElement;
  btnHold: HTMLButtonElement;
  initialFpsLast: number;
}

export function createMotionPreviewView(mount: HTMLElement): MotionPreviewView {
  mount.className = "devtools-panel motion-preview";
  mount.innerHTML = `
    <div class="motion-preview__viewport">
      <div class="viewport-label">VRM Viewport</div>
      <div id="vrm-mount"></div>
      <div class="viewport-status" id="viewport-status">idle · 0fps</div>
    </div>
    <div class="motion-preview__rail">
      <div class="rail-scroll">
        <div class="section">
          <div class="section-header"><span class="section-label">Registry</span><div class="section-divider"></div></div>
          <div id="registry-list"></div>
        </div>
        <div class="section-sep"></div>
        <div class="playback-section">
          <div class="section-header"><span class="section-label">Playback</span><div class="section-divider"></div></div>
          <div class="playback-row"><span class="playback-label">loop</span><div class="playback-control"><label class="cb-wrap"><input type="checkbox" id="cb-loop" checked /><span class="cb-label">enabled</span></label></div></div>
          <div class="playback-row"><span class="playback-label">speed</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-speed" min="0.25" max="2.5" step="0.05" value="1.0" /><span class="slider-value" id="val-speed">1x</span></div></div></div>
          <div class="playback-row"><span class="playback-label">fade</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-fade" min="0" max="600" step="10" value="200" /><span class="slider-value" id="val-fade">200ms</span></div></div></div>
          <div class="playback-row"><span class="playback-label">crossfade →</span><div class="playback-control"><select id="sel-crossfade"></select></div></div>
          <div class="btn-row"><button class="btn btn-primary" id="btn-play">play</button><button class="btn btn-stop" id="btn-stop">stop</button><button class="btn btn-idle" id="btn-idle">→ idle</button></div>
        </div>
        <div class="section-sep"></div>
        <div class="section">
          <div class="section-header"><span class="section-label">Emotion</span><div class="section-divider"></div></div>
          <div id="emotion-list"></div>
          <div class="playback-row"><span class="playback-label">intensity</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-intensity" min="0" max="1" step="0.05" value="1" /><span class="slider-value" id="val-intensity">1.00</span></div></div></div>
          <div class="playback-row"><span class="playback-label">transition</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-transition" min="0" max="1000" step="10" value="250" /><span class="slider-value" id="val-transition">250ms</span></div></div></div>
          <div class="btn-row"><button class="btn btn-primary" id="btn-neutral">→ neutral</button><button class="btn btn-stop" id="btn-hold">hold (null)</button></div>
        </div>
      </div>
      <div class="status-bar"><span class="status-text"><span class="status-key">now: </span><span class="status-accent" id="status-now">loading</span><span class="status-key"> · </span><span class="status-val" id="status-kind">-</span><span class="status-key"> · </span><span class="status-val" id="status-priority">-</span><span class="status-key"> · </span><span class="status-val" id="status-elapsed">0.0s</span><span class="status-key"> · </span><span class="status-val" id="status-fps">0fps</span></span></div>
    </div>
  `;

  const initialFpsLast = performance.now();

  // ─── DOM refs ─────────────────────────────────────────────────────────────

  const vrmMount = mount.querySelector("#vrm-mount") as HTMLDivElement;
  const registryList = mount.querySelector("#registry-list") as HTMLDivElement;
  const cbLoop = mount.querySelector("#cb-loop") as HTMLInputElement;
  const slSpeed = mount.querySelector("#sl-speed") as HTMLInputElement;
  const valSpeed = mount.querySelector("#val-speed") as HTMLSpanElement;
  const slFade = mount.querySelector("#sl-fade") as HTMLInputElement;
  const valFade = mount.querySelector("#val-fade") as HTMLSpanElement;
  const selCrossfade = mount.querySelector("#sel-crossfade") as HTMLSelectElement;
  const btnPlay = mount.querySelector("#btn-play") as HTMLButtonElement;
  const btnStop = mount.querySelector("#btn-stop") as HTMLButtonElement;
  const btnIdle = mount.querySelector("#btn-idle") as HTMLButtonElement;
  const statusNow = mount.querySelector("#status-now") as HTMLSpanElement;
  const statusKind = mount.querySelector("#status-kind") as HTMLSpanElement;
  const statusPriority = mount.querySelector("#status-priority") as HTMLSpanElement;
  const statusElapsed = mount.querySelector("#status-elapsed") as HTMLSpanElement;
  const statusFps = mount.querySelector("#status-fps") as HTMLSpanElement;
  const viewportStatus = mount.querySelector("#viewport-status") as HTMLSpanElement;

  // ─── Emotion DOM refs ─────────────────────────────────────────────────────
  const emotionList = mount.querySelector("#emotion-list") as HTMLDivElement;
  const slIntensity = mount.querySelector("#sl-intensity") as HTMLInputElement;
  const valIntensity = mount.querySelector("#val-intensity") as HTMLSpanElement;
  const slTransition = mount.querySelector("#sl-transition") as HTMLInputElement;
  const valTransition = mount.querySelector("#val-transition") as HTMLSpanElement;
  const btnNeutral = mount.querySelector("#btn-neutral") as HTMLButtonElement;
  const btnHold = mount.querySelector("#btn-hold") as HTMLButtonElement;

  // ─── Slider display updates ─────────────────────────────────────────────

  slSpeed.addEventListener("input", () => {
    valSpeed.textContent = formatSpeed(parseFloat(slSpeed.value));
  });

  slFade.addEventListener("input", () => {
    valFade.textContent = `${slFade.value}ms`;
  });

  slIntensity.addEventListener("input", () => {
    valIntensity.textContent = parseFloat(slIntensity.value).toFixed(2);
  });

  slTransition.addEventListener("input", () => {
    valTransition.textContent = `${slTransition.value}ms`;
  });

  return {
    mount,
    vrmMount,
    registryList,
    cbLoop,
    slSpeed,
    slFade,
    selCrossfade,
    btnPlay,
    btnStop,
    btnIdle,
    statusNow,
    statusKind,
    statusPriority,
    statusElapsed,
    statusFps,
    viewportStatus,
    emotionList,
    slIntensity,
    slTransition,
    btnNeutral,
    btnHold,
    initialFpsLast,
  };
}
