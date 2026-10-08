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
        <div>
          <h1 class="hero-title">The head.<br />Not the brain.</h1>
          <p class="hero-lede">
            A VRM character who lives on your desktop, watches the cursor, and
            speaks when the agent you connect has something to say.
          </p>
          <div class="hero-cta">
            <a :href="withBase('/guide/getting-started')" class="btn btn--primary"
              >Get started</a
            >
            <a
              href="https://youtu.be/dIOQdoAp0GE"
              rel="noopener"
              target="_blank"
              class="btn btn--quiet"
              >Watch the demo ↗</a
            >
            <a
              href="https://github.com/yw0nam/YUI/releases/latest"
              rel="noopener"
              target="_blank"
              class="btn btn--quiet"
              >Download ↗</a
            >
          </div>
        </div>

        <figure class="media">
          <video
            ref="heroVideo"
            :src="withBase('/yui-hero.mp4')"
            :poster="withBase('/yui-hero-poster.jpg')"
            aria-label="YUI standing on top of a browser window, her eyes following the mouse cursor"
            width="820"
            height="462"
            muted
            loop
            playsinline
          />
        </figure>
      </section>

      <!-- Locomotion -->
      <section class="sec" aria-labelledby="windows-heading">
        <h2 class="h2" id="windows-heading">She lives on your windows</h2>
        <p class="sub">
          She perches on a window top, peeks around a side edge, strolls the
          floor, and jumps between windows. Dropped in mid-air, she falls to
          the first surface below and lands.
        </p>
        <div class="feat-wide">
          <figure class="media">
            <img
              :src="withBase('/yui-locomotion.gif')"
              alt="YUI walking along the bottom of the screen, climbing a side edge, and sitting on a window top"
              width="720"
              height="465"
              loading="lazy"
            />
          </figure>
        </div>

        <!-- Feature pair -->
        <div class="pair">
          <article class="card">
            <figure class="media">
              <img
                :src="withBase('/yui-feature-cues.jpg')"
                alt="YUI laughing with a hand over her mouth above a speech bubble"
                width="720"
                height="540"
                loading="lazy"
              />
            </figure>
            <div>
              <h3 class="h3">Any backend, embodied</h3>
              <p>
                Chat Completions, the Responses API, or a push WebSocket.
                Emotion, motion, voice tag and caption arrive as
                <code>generate_express</code> cues beside the reply, so she
                reacts instead of just answering.
              </p>
            </div>
          </article>
          <article class="card">
            <figure class="media">
              <img
                :src="withBase('/yui-feature-proactive.png')"
                alt="The reactions settings tab with screen watch, loop reactions and scheduled greetings"
                width="720"
                height="540"
                loading="lazy"
              />
            </figure>
            <div>
              <h3 class="h3">She speaks first</h3>
              <p>
                Screen changes, quiet stretches and set times fire cues to the
                backend. Whether to say anything is the backend's call; YUI
                only renders what comes back.
              </p>
            </div>
          </article>
        </div>
      </section>

      <!-- Body and brain -->
      <section class="sec" aria-labelledby="body-brain-heading">
        <h2 class="h2" id="body-brain-heading">
          YUI is the body. Your agent is the brain.
        </h2>
        <p class="sub">
          YUI ships no model. It renders, senses and fires; judgment, persona
          and memory belong to whatever you plug in, so she is exactly as smart
          and as yours as that backend.
        </p>
        <div class="split">
          <div class="col">
            <h3>YUI does</h3>
            <ul>
              <li>VRM rendering, lipsync, expressions and motions</li>
              <li>Text and voice input, screen capture</li>
              <li>Speech bubble, status pill, settings</li>
              <li>Firing proactive cues on a schedule or a screen change</li>
            </ul>
          </div>
          <div class="col">
            <h3>Your agent does</h3>
            <ul>
              <li>The agent loop, memory and tools</li>
              <li>Persona and mood</li>
              <li>Emotion and motion cues</li>
              <li>Deciding whether to speak at all</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- What you need -->
      <section class="sec" aria-labelledby="need-heading">
        <h2 class="h2" id="need-heading">What you need</h2>
        <p class="sub">
          One required piece, and it ships in the repo. Add a brain and a voice
          when you are ready.
        </p>
        <div class="req">
          <b>Required</b>
          <span>
            A VRM model. A default one is bundled; bring any VRM 0.x or 1.0
            file to replace it.
          </span>
        </div>
        <div class="opt">
          <div>
            <b>Chat backend</b>
            <span
              >Any OpenAI-compatible endpoint, a Responses API agent, or a push
              WebSocket.</span
            >
          </div>
          <div>
            <b>Expression broker</b>
            <span
              >Deprecated, removed in v0.6.0: the client declares its tools
              on the request.</span
            >
          </div>
          <div>
            <b>TTS provider</b>
            <span
              >Irodori TTS Server or any OpenAI-compatible speech
              endpoint.</span
            >
          </div>
          <div>
            <b>STT and VAD</b>
            <span
              >Silero VAD segments speech; any transcription server turns it
              into text.</span
            >
          </div>
          <div>
            <b>Reference voice</b>
            <span
              >A clip to clone the character's voice, uploaded from the
              panel.</span
            >
          </div>
          <div>
            <b>Standalone Mods</b>
            <span
              >Independent MCP servers: router, desktop control, shell sandbox,
              avatar.</span
            >
          </div>
          <div>
            <b>Custom expression set</b>
            <span>Map emotion cues to your VRM's own blend shapes.</span>
          </div>
        </div>
      </section>

      <!-- Closing -->
      <section class="close" aria-label="Get started">
        <p>Ready to wire her up?</p>
        <a :href="withBase('/guide/getting-started')" class="btn btn--primary"
          >Get started</a
        >
      </section>
    </main>

    <!-- Footer -->
    <footer class="home-foot">
      <span>YUI · PolyForm Noncommercial 1.0.0</span>
      <span class="home-foot-links">
        <a :href="withBase('/guide/getting-started')">Guide</a>
        <a :href="withBase('/reference/client-context')">Reference</a>
        <a href="https://github.com/yw0nam/YUI" rel="noopener" target="_blank"
          >GitHub</a
        >
      </span>
    </footer>
  </div>
</template>
