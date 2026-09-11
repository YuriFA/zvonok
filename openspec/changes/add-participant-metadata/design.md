# Design: add-participant-metadata

## Decisions

1. **Verbatim carry, no interpretation.** `externalId` and `metadata` travel
   mint DTO -> token claims -> peer payloads -> webhooks untouched. The
   server never reads them; they are correlation data owned by the consumer.
   This keeps authorization (roles/capabilities) and identity correlation
   orthogonal - the 0.3.0 lesson.
2. **Absent vs null.** Token paths without the fields omit them from payloads
   (JSON `undefined`, not `null`), so consumers can distinguish "minted
   without" from "empty". Cookie/guest paths never carry the fields.
3. **Limits enforced once, at mint.** `externalId` 1-64 chars, `metadata` a
   JSON object serialized to at most 2048 bytes (validate with
   `JSON.stringify().length`). The claims already live inside a short-lived
   JWT; 2 KB keeps the token comfortably small while covering avatar URLs,
   roles, tenant ids.
4. **Peer payload shape.** Fields ride the existing participant identity
   object in `sfu:joined` ack, `sfu:peer-joined`, and the existing-
   participants snapshot - no new events, no new payload type. The peer map
   stores them alongside display name at join resolution.
5. **Webhook parity.** `participant.joined`/`participant.left` read the same
   stored peer fields, so both events carry identical correlation data for
   one participant, enabling left-side reconciliation without state.
