# What it does

- Serves `ws://<host>:<port>/ws`. The client sends `hello` with its key, its `chat_id` and the
  vocabulary it can render; the plugin answers `ready` and keeps the socket open.
- States `max_turn_bytes` of 4 MiB in `ready`, so the client may put the turn's screenshot and the
  user's attached images on the `turn` frame. It accepts a `turn` frame up to that size and every
  other frame up to 256 KiB, except a `tool_result` with a non-empty list of image data URLs,
  which also has the 4 MiB cap. It stores each turn image as a cached file and hands its path to the
  gateway with the turn; an image it cannot decode or store is left out and the turn is still
  handled.
- Turns the `turn` frame into a gateway message: the rendered `client_context` block, a blank
  line, then the user's utterance.
- Accepts `playback` frames with `ended: "failed"` after `ready`. A failed frame
  for a turn the adapter closed with an `error` frame writes one log line and
  starts no gateway message. A failed frame for another turn starts one gateway
  message with a one-line notice naming the turn, `internal=True`,
  `reply_expected=False` and `allow_gateway_control=False`, from the same
  direct-message source as a client turn. Other outcomes are malformed frames
  and are dropped with a warning. Playback notices use no held-report queue;
  they arrive over the connected socket.
- Registers `generate_express`, whose enums are the emotion ids, motion ids and voice-tone tags
  the client published. The model calls it once per reply, listing every cue in speaking order
  and naming the sentence each one belongs before. Hermes defers the tool behind its tool search:
  with `tools.tool_search.enabled` at its default `auto`, a tool that is neither a core Hermes tool
  nor in a direct-surface toolset leaves the model's tool list, and the `tool_search`,
  `tool_describe` and `tool_call` bridge tools take its place with a listing of names and
  descriptions. `generate_express` is in this plugin's `yui` toolset, so the model reaches it
  through that bridge.
- Sends the answer while the agent writes it: each finished sentence leaves as a `speech` frame
  carrying every cue whose `sentence` opens it, or else the next cue that names no sentence. A
  sentence goes out as the gateway sends text, with media tags, image links and paths of local
  files taken out, and a sentence those leave empty is not spoken at all. The reply the gateway
  sends then leaves as a `render` frame carrying the sentences not yet sent, each with the cues that
  landed on it, and cues left over after streamed speech still play. A reply that does not continue
  the streamed text renders whole. A turn the agent answers with `[SILENT]`, or with nothing, closes
  with no speech, and the cues it placed still play. Every turn reaches the gateway with
  `reply_expected=False`, so the gateway leaves a bare `[SILENT]` silent on a turn the user typed too.
- Logs and never renders the text the gateway writes for itself: the busy acknowledgement when
  a turn lands mid-run, every status notice, the warnings the gateway raises during a turn
  (deferred compression, a failed background task, a stuck run, a failed media send), and the
  restart, startup and shutdown pings, which the plugin turns off for this platform. What the
  agent writes before a tool call, its final reply, and its answer to a delegation report all
  render as usual. The gateway's notice that a turn failed depends on the client. A client whose
  `hello` lists `error` in `accepts` gets it as an `error` frame carrying its text as one line and
  nothing renders it, and each open turn of the chat ends with its `turn_end`, `error` frame
  first. A client that lists no `error` gets it rendered in the same shape as the agent's words,
  and the failed turn ends behind it with no `error` frame. A failed turn that gets no notice
  ends with `turn_end` alone.
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
  arrives names its id. Only a text-only turn is taken into a running turn: a turn that carries
  images waits for the running turn or interrupts it, by the gateway's busy-input setting. A turn
  the gateway started on its own, such as a cron result, carries an
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
- Carries the token usage of the turn's last LLM call in the `usage` field of its `turn_end` frame,
  taken from the gateway's `post_api_request` hook. `input_tokens` is the hook's `prompt_tokens`,
  the whole prompt including cached tokens, so `total_tokens` measures how full the context is.
  The plugin keeps the latest call per chat, attributes it to the chat of the turn in flight as the
  reasoning hook does, and clears it when the frame is sent. A turn with no call, a call from
  another platform or a delegated child, and a call whose usage lacks one of the three figures send
  no `usage`.
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
- Registers the tools the client declares in its `hello.tools` frame — once per schema fingerprint,
  under the `yui` toolset — so the model calls `body_action` to move the character and `look` to
  read her state. Each call sends one `tool_call` frame and blocks the handler's worker thread on
  the `tool_result`: 20 s for `body_action`, 7 s for `look`, counted from the send (the client
  bounds its own execution 5 s below that). One call runs at a time per chat; a second waits for
  the first. A call answers `error: client disconnected` at once when no ready socket can take it,
  when the socket closes, or when a second hello replaces it, and `error: turn stopped` when the
  client stops the turn the call belongs to; a wait that passes answers
  `error: no reply from the client within <n> s`. The `post_tool_call` hook sends `tool_status`
  `failed` instead of `done` when the call errored, when a `body_action` result is not `ok`, or
  when a `look` result starts with `error:`.

- Returns a client tool result with images as Hermes's `_multimodal` envelope: a text part followed
  by `image_url` parts carrying the data URLs inline, without file caching. A result without images
  is a string. The tool-status hook reads the envelope's text for failure classification.
  `look at: screen` needs an image-capable model and provider; Hermes substitutes a text summary
  when the model has no vision or the provider rejects list content.
