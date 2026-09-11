# Tasks: add-participant-metadata

## 1. Server: mint and claims

- [x] 1.1 `platform.dto.ts`: add optional `externalId` (IsString, 1-64 chars) and `metadata` (IsObject + serialized size <= 2048 bytes validator) to the mint DTO; unit tests for valid, oversized, and non-object cases
- [x] 1.2 `platform.service.ts` mint + `room-token.helper.ts`: carry `externalId` and `metadata` into the token claims verbatim; helper spec coverage

## 2. Server: SFU peer identity and webhooks

- [x] 2.1 `sfu.interface.ts` / `sfu.service.ts`: peer identity payloads (join ack participant, peer-joined broadcast, existing-participants snapshot) carry `externalId`/`metadata` from verified token claims; absent on cookie/guest paths; unit tests
- [x] 2.2 `webhook-dispatcher.service.ts`: `participant.joined`/`participant.left` payloads include the fields when present; dispatcher tests
- [x] 2.3 e2e: extend the identity e2e - token-path join surfaces fields in peer events and webhooks; cookie path surfaces neither

## 3. SDK and docs

- [x] 3.1 `packages/client` types: `SfuParticipantInfo` gains optional `externalId?: string` and `metadata?: unknown`; tsc + suite green
- [x] 3.2 `docs/api-reference.md`: mint section documents `externalId`/`metadata` (limits, optionality) and webhook payload examples show them
- [x] 3.3 Verify: server tsc + unit + e2e suites green; packages/client green
