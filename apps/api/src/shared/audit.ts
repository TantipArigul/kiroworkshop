// E-mail and username identify a person (NFR-005); audit rows reference actors by internal ID only.
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|csrf|email|password|path|secret|session|storage|token|username/i;

export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAuditMetadata);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactAuditMetadata(nestedValue),
      ]),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
