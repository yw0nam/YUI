# Gmail producer

A producer that turns mail the user marks with a Gmail label into Threads, collects an
answer, and sends the reply in the same Gmail thread. The user decides the scope in
Gmail: a label of their own (for example `YUI`) applied by their own filter.

The tool that calls Gmail — the API, a CLI, an n8n node — is yours to pick; where a step
names no exact call, check your tool's docs.

## Post the Thread

Each run lists the threads carrying the label and posts one Thread per Gmail thread, id
`gmail:<threadId>`. The entries carry the sender, the subject, and the latest message's
plain text, within the contract's entry limits. The ask is free text: `text: true`, no
choices, prompt "Reply".

Done when: one labelled mail shows as a Thread in the Threads window.

## Act on the answer

The only answer shape is text: send the reply in the same Gmail thread. Threading needs
the thread id and `In-Reply-To` and `References` headers pointing at the last message's
`Message-Id`; check your tool's docs for how it sets them. Then remove the label, and PUT
a `system` entry with the result: state `completed`, or `failed` with the error, leaving
the label in place so the mail stays in the producer's scope.

Record the answer durably before sending and leave the retry to the user: follow
SKILL.md step 5.

Done when: the reply sits in the Gmail thread, the label is gone, and the Thread shows
the result entry.

## Credentials

Scopes to read and to send, plus the scope that modifies labels, since the answer
removes one. Check your tool's docs for the exact scope names.
