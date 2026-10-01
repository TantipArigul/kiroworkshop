# Correctness Properties — Foundation Unit

## Overview
**PBT Framework**: fast-check 4.10.2. Run a minimum of 100 generated cases per property; shrink counterexamples and save only sanitized diagnostic data.

## Properties

### 1. Authorization Isolation
**Validates**: US-002, US-009, US-011, US-014, US-015

**Property**: For every generated pair of distinct owners and resource IDs, an actor without owner/explicit permission cannot read, alter, delete or download the resource, and receives the same safe denial shape whether the resource exists or not.

**Generators**: distinct `userId`, `resourceId`, role and permission-set generators.

**Edge cases**: missing session, disabled user, Admin without explicit private-resource permission, malformed ID.

### 2. Valid Job State Transition
**Validates**: US-005, US-007, US-008

**Property**: Any generated state transition sequence only persists `QUEUED → RUNNING → COMPLETED|FAILED`; invalid transitions do not mutate current state or expose a final artifact.

**Generators**: status sequence, executor outcome and retry sequence.

**Edge cases**: duplicate completion, failure after completion, startup executor unavailable.

### 3. Idempotent Submission
**Validates**: US-005

**Property**: Repeating a valid submission with the same owner and idempotency key yields exactly one Job record and the same Job ID; different owners do not collide.

**Generators**: owner IDs, valid input DTOs and idempotency keys.

**Edge cases**: retry after timeout, empty key, concurrent simulated submission.

### 4. Redaction Safety
**Validates**: US-004, US-008, US-015

**Property**: Generated secrets, cookies, paths and input payload fragments cannot appear in serialized log/audit/error output; permitted safe identifiers and request IDs remain traceable.

**Generators**: nested input objects containing marker secrets/paths/tokens.

**Edge cases**: error causes, arrays, nested metadata, Unicode values and filenames.

### 5. Retention Deletion Closure
**Validates**: US-014

**Property**: For every generated expired Job graph, cleanup makes Job/Input/Status/Result/Recommendation unavailable to future authorized and unauthorized reads while retaining only the minimum redacted audit record.

**Generators**: Job graph, expiry timestamp and artifact set.

**Edge cases**: partially missing artifact, cleanup retry, concurrent read during deletion.

## Test Configuration
- **Timeout**: 10 seconds per property suite unless a test specifically sets a lower deterministic cap.
- **Shrinking**: enabled; counterexamples are sanitized before test output.
- **Run**: `pnpm test:properties`.
