# What it does

- Serves `ws://<host>:<port>/ws`. The client sends `hello` with its key, its `chat_id` and the
  vocabulary it can render; the plugin answers `ready` and keeps the socket open.
- Turns the `turn` frame into a gateway message: the rendered `client_context` block, a blank
  line, then the user's utterance.
- Registers `generate_express`, whose enums are the emotion ids, motion ids and voice-tone tags
  the client published. The model calls it once per reply, listing every cue in speaking order
  and naming the sentence each one belongs before.
- Sends the answer while the agent writes it: each finished sentence leaves as a `speech` frame
  carrying every cue whose `sentence` opens it, or else the next cue that names no sentence. The
  reply the gateway sends then leaves as a `render` frame carrying the sentences not yet sent, each
  with the cues that landed on it, and cues left over after streamed speech still play. A reply
  that does not continue the streamed text renders whole. A turn the agent answers with
  `[SILENT]`, or with nothing, closes with no speech, and the cues it placed still play.
- Logs and never renders the text the gateway writes for itself: the busy acknowledgement when
  a turn lands mid-run, every status notice, and the restart, startup and shutdown pings, which
  the plugin turns off for this platform. What the agent writes before a tool call, its final
  reply, and its answer to a delegation report all render as usual, and so does the gateway's
  notice that a turn failed, which reaches the plugin in the same shape as the agent's words. The
  failed turn ends behind that notice.
- Streams the agent's reasoning to the client as `reasoning` frames, coalesced to one frame per
  100 ms. The `render` frame carries the reasoning written so far for its turn, which on the
  reply that ends the turn is the whole text. The gateway offers the live tokens only while
  `plugins.stream_reasoning_deltas` is `true`; with it off, the `render` frame carries no
  `reasoning`.
- Never delivers audio, images, video or files. `voice.auto_tts` is off for this platform, and
  the audio a `/voice all` chat still makes is discarded. The client speaks the reply itself.
- Makes the first chat that connects the platform's home channel, which is where the gateway
  delivers cron results and cross-platform messages.
- Reads the answer from the gateway's `on_stream_delta` hook, so the gateway's `streaming` setting
  does not apply to this platform. The hook names no chat, so the answer streams to the sole
  connected client. Text a background review streams is not spoken. The gateway drops a newline
  that opens a streamed chunk, so a line that does not end in a CJK terminator runs into the next
  line with no space between them, and a cue that names that next line plays later in the reply.
  A provider retry in the middle of an answer streams its text again, so `speech` frames can repeat
  sentences. Deltas the gateway's hook queue drops under load leave a gap, and the `render` can then
  repeat the whole answer. A hook queue that falls a whole turn behind speaks that turn's text under
  the next turn.
- Never holds a `speech` frame for a client that is away. A client that disconnects mid-answer, or
  connects while a turn runs, gets the rest of that turn in its `render`. The same holds for a turn
  whose text streams while no single client is connected, while the reset acknowledgement is still
  unspoken, or after a `speech` frame fails to send.
- Names the most recently arrived turn — open or joined — in every reply of a run, and clears the
  name when the turn ends. A turn the gateway runs inside a turn it interrupted ends first, and the
  interrupted turn ends behind it. A turn whose text the gateway takes into a turn already running
  on the same chat ends when that turn ends, and every frame the plugin sends after that turn
  arrives names its id. A turn the gateway started on its own, such as a cron result, carries an
  id the plugin mints, of the form `hermes-<n>`, counted per gateway process.
- Sends a `delegations` frame whenever background work starts or finishes, so the client can show
  what is running; each finished item carries its `status` and `summary`. The plugin holds fifty
  items per chat, dropping the oldest finished one past that, and drops summaries oldest-first
  from a frame over the size limit. The platform hint tells the agent to hand long independent
  work to a background delegation when a delegation tool is available.
- Sends a `tool_status` frame from the gateway's `pre_tool_call` and `post_tool_call` hooks for
  each tool call of a YUI turn, so the client can show and name the tool in use. A frame for a chat
  with no connected client or no turn held, open or joined, is dropped, never held and never retried.
  `generate_express` sends none, and neither does a tool call a delegated child makes.
- Holds reports that arrive while the client is away, up to forty, and delivers them as one
  summary turn when it connects again. A reply that finishes while the client is away is held the
  same way and sent first when it reconnects. Both live in memory, so a gateway restart while the
  client is away drops them.
- Starts a new conversation on `reset` and ends the delegations still running for that chat. The
  gateway asks to confirm `/new`, and the plugin approves it because the client already did.
- Stops the session's running agent on `stop`, which the client sends when the user presses stop.
  The frame carries the turn ids the client just stopped, and the plugin hands the gateway `/stop`
  only when at least one of them is still open on the chat and every open turn is named. A `stop`
  that arrives while a turn the frame does not name is open — one the gateway started on its own
  that the client has not seen a `render` of, or one that began after the client stopped — does
  nothing, and neither turn ends. A turn the gateway folded into the running one is not open on
  its own and ends with it. The acknowledgement `/stop` makes is never spoken, and each
  turn the cancellation closes ends with one `turn_end`. The gateway's `/stop` interrupts the
  running turn only: a delegation runs in the background apart from the turn that started it, so
  it keeps running and reports when it finishes.
- Declares the `generate_express` schema when a turn opens, from the vocabulary that turn's chat
  published. The gateway holds one schema per process, and a turn reads it when its agent is built
  and again when it compacts its context, so a turn that reaches either point after another chat's
  turn opened runs with the other chat's ids. Each switch between chats whose vocabularies differ
  rebuilds the gateway's cached agents.
