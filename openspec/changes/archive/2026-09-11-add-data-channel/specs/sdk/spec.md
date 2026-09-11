# sdk

## ADDED Requirements

### Requirement: Data channel
The SDK SHALL expose the room's ephemeral data channel: a send action
`sendBroadcast(topic, payload)` that settles on the server's acknowledgement
with authorization, size, and topic denials surfacing as typed broadcast
errors carrying the server's coded error, and an incoming-broadcast
subscription delivering `{senderId, topic, payload, timestamp}` messages for
other participants' broadcasts without polling. The React layer SHALL expose
both as hooks: a send hook returning the ack-settled action, and a
topic-filtered receive hook delivering only messages of its topic.

#### Scenario: Consumer sends and settles
- **WHEN** a capable consumer calls the send action with a topic and payload and the server accepts
- **THEN** the action resolves and other participants' receive surfaces deliver the message

#### Scenario: Denial surfaces as typed error
- **WHEN** a consumer without `send-data-message` calls the send action
- **THEN** the action rejects with a typed broadcast error carrying the server's coded authorization error

#### Scenario: Receive hook filters by topic
- **WHEN** a consumer subscribes to topic `reactions` and broadcasts arrive on `reactions` and `chat`
- **THEN** only the `reactions` messages reach that consumer's receive hook

#### Scenario: Sender does not receive their own message
- **WHEN** a consumer sends a broadcast
- **THEN** their own receive surfaces do not deliver that message back
