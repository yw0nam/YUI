# Gmail producer

A producer that turns mail the user marks with a Gmail label into Threads, and sends the
reply in the same Gmail thread when the user tells the character to. The user picks the
scope in Gmail: a label of their own (for example `YUI`), applied by their own filter.

The tool that calls Gmail (an API, a CLI, a workflow node) is yours to pick. Where a step
names no exact call, check that tool's docs.

## Post the Thread

Each run lists the threads carrying the label and posts one Thread per Gmail thread, with
id `gmail:<threadId>`. The entries carry the sender, the subject, and the latest message's
plain text, within the entry limits of `docs/reference/threads.md`.

Post `input-required` when the mail waits for a reply from the user. Post `completed` when
it needs none.

Done when: one labelled mail shows as a Thread in the Threads window.

## Act on the user's request

When the user tells the character to reply, send the reply in the same Gmail thread.
Threading needs the thread id and `In-Reply-To` and `References` headers that point at the
last message's `Message-Id`. Check the tool's docs for how it sets them. Then remove the
label, so the mail leaves the producer's scope, and PUT a `system` entry naming the result
with state `completed`.

If sending fails, PUT state `failed` with the error, and leave the label in place so the
mail stays in scope.

If the reply is sent but the label removal fails, PUT a `system` entry saying the reply was
sent and the label remains. Check the Gmail thread for the sent reply before any retry, so
the reply is not sent twice.

Done when: the reply sits in the Gmail thread, the label is gone, and the Thread shows the
result entry.

## Credentials

The integration's identity needs scopes to read threads and messages, to send mail, and to
modify labels. Check the tool's docs for the exact scope names.
