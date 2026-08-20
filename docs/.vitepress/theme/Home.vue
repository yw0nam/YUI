<script setup lang="ts">
import { withBase } from 'vitepress'
import { onMounted, ref } from 'vue'

const heroVideo = ref<HTMLVideoElement | null>(null)

// The hero loop starts from script, so a reduced-motion reader keeps the still poster.
onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  heroVideo.value?.play()
})
</script>

<template>
  <div class="yui-home">
    <main class="yui-main">
      <!-- Hero -->
      <section class="hero" aria-label="Hero">
        <div class="hero-content">
          <p class="hero-eyebrow">Embodied VRM desktop companion</p>
          <h1 class="hero-title">The head.<br />Not the brain.</h1>
          <p class="hero-tagline">
            YUI renders a living VRM character on your desktop. It senses text,
            voice, and screen context, then leaves all judgment to the Hermes
            backend you wire in.
          </p>
          <div class="hero-cta">
            <a :href="withBase('/guide/getting-started')" class="btn-primary"
              >Get Started</a
            >
            <a
              href="https://github.com/yw0nam/YUI"
              rel="noopener"
              target="_blank"
              class="btn-ghost"
              >View on GitHub ↗</a
            >
            <a
              href="https://youtu.be/dIOQdoAp0GE"
              rel="noopener"
              target="_blank"
              class="btn-ghost"
              >Watch demo ↗</a
            >
          </div>
        </div>

        <div class="hero-image">
          <figure class="hero-frame">
            <video
              ref="heroVideo"
              :src="withBase('/yui-hero.mp4')"
              :poster="withBase('/yui-hero-poster.jpg')"
              aria-label="YUI, a VRM character on the desktop: her head and eyes follow the mouse cursor, then she answers a typed question about what is on screen"
              width="820"
              height="462"
              muted
              loop
              playsinline
            />
          </figure>
        </div>
      </section>

      <!-- Body vs Mind framing -->
      <section class="framing" aria-labelledby="framing-heading">
        <div class="framing-copy">
          <h2 class="framing-heading" id="framing-heading">
            YUI is the body.<br />Hermes is the brain.
          </h2>
          <p class="framing-body">
            YUI is the <em>embodied frontend</em>: rendering, sensing, and the
            I/O surfaces. That is its whole domain.
          </p>
          <p class="framing-body">
            Judgment, persona, memory, and the agent loop belong to the
            <strong>Hermes backend</strong> you connect. YUI fires events and
            renders whatever comes back; it never decides whether or what to
            speak. That line is the system's load-bearing principle.
          </p>
        </div>

        <div class="framing-aside">
          <div class="callout">
            <p class="callout-label">YUI · the head</p>
            <p class="callout-title">Rendering + sensing + I/O</p>
            <p class="callout-body">
              VRM character · lipsync · speech bubble · tool-status chip · text
              &amp; voice input · screen capture · proactive trigger firing
            </p>
          </div>
          <div class="callout">
            <p class="callout-label">Hermes · the brain</p>
            <p class="callout-title">Judgment + persona + tools</p>
            <p class="callout-body">
              Agent loop · memory · LLM reasoning · tool execution ·
              emotion/motion cues · silence decisions, all delegated to the
              backend you supply
            </p>
          </div>
        </div>
      </section>

      <!-- Setup Map -->
      <section class="setup" aria-labelledby="setup-heading">
        <div class="setup-header">
          <h2 class="setup-heading" id="setup-heading">
            What you need to run YUI
          </h2>
          <p class="setup-sub">
            Three required pieces; everything else is optional. Start minimal;
            add voice when you're ready.
          </p>
        </div>

        <div class="setup-tiers">
          <!-- Required -->
          <div class="tier tier--required">
            <span class="tier-badge tier-badge--required">Required</span>
            <p class="tier-title">Core</p>
            <ul class="tier-items">
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">VRM model file</p>
                  <p class="tier-item-note">Your character. Any VRM 0.x/1.0 file.</p>
                </div>
              </li>
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">Hermes backend agent</p>
                  <p class="tier-item-note">
                    The brain: any OpenAI-compatible agent running the Responses
                    API.
                  </p>
                </div>
              </li>
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">Expression broker</p>
                  <p class="tier-item-note">
                    Translates <code>generate_express</code> cues into VRM blend
                    shapes.
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <!-- Optional -->
          <div class="tier tier--optional">
            <span class="tier-badge tier-badge--optional">Optional</span>
            <p class="tier-title">Add-ons</p>
            <ul class="tier-items">
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">TTS provider</p>
                  <p class="tier-item-note">
                    Fish Speech, Style-BERT-VITS2, or any streaming TTS endpoint.
                  </p>
                </div>
              </li>
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">STT + VAD</p>
                  <p class="tier-item-note">
                    Whisper-based turn detection for voice input.
                  </p>
                </div>
              </li>
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">Reference voice</p>
                  <p class="tier-item-note">
                    A .wav file to clone the character's voice with Fish Speech.
                  </p>
                </div>
              </li>
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">Standalone Mods</p>
                  <p class="tier-item-note">
                    Independent MCP servers: memory, tools, integrations.
                  </p>
                </div>
              </li>
              <li class="tier-item">
                <span class="tier-item-dot" aria-hidden="true"></span>
                <div>
                  <p class="tier-item-name">Custom expression set</p>
                  <p class="tier-item-note">
                    Map emotion cues to your VRM's own blend shapes.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- CTA strip -->
      <div class="cta-strip">
        <div class="cta-strip-text">
          <h2>Ready to wire it up?</h2>
          <p>
            The Getting Started guide walks through every required and optional
            piece.
          </p>
        </div>
        <a :href="withBase('/guide/getting-started')" class="btn-primary"
          >Getting Started →</a
        >
      </div>
    </main>

    <!-- Footer -->
    <footer class="home-footer">
      <div class="footer-inner">
        <p class="footer-copy">
          YUI · MIT License ·
          <a href="https://github.com/yw0nam/YUI" rel="noopener" target="_blank"
            >github.com/yw0nam/YUI</a
          >
        </p>
        <ul class="footer-links">
          <li><a :href="withBase('/')">Home</a></li>
          <li><a :href="withBase('/guide/getting-started')">Guide</a></li>
          <li><a :href="withBase('/reference/client-context')">Reference</a></li>
          <li>
            <a href="https://github.com/yw0nam/YUI" rel="noopener" target="_blank"
              >GitHub ↗</a
            >
          </li>
        </ul>
      </div>
    </footer>
  </div>
</template>
