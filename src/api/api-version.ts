// Provider API version checks. Pure Node.

/** Accepts a positive integer or a numeric string ("1", " 1 "). Anything else gives undefined. */
export function normalizeApiVersion(value: unknown): number | undefined {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const text = value.trim();
    if (!/^\d+$/.test(text)) return undefined;
    n = Number(text);
  } else {
    return undefined;
  }
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export type ApiVersionCheck = { ok: true; version: number } | { ok: false; reason: string };

export function checkApiVersion(
  moduleName: string,
  value: unknown,
  supported: readonly number[],
): ApiVersionCheck {
  const version = normalizeApiVersion(value);
  if (version === undefined) {
    return { ok: false, reason: `${moduleName} did not say which Provider API version it uses.` };
  }
  if (supported.includes(version)) return { ok: true, version };
  const newest = Math.max(...supported);
  if (version > newest) {
    return {
      ok: false,
      reason: `${moduleName} needs Provider API v${version}, but this AI Ecosystem supports v${supported.join(", v")}. Update AI Ecosystem.`,
    };
  }
  return {
    ok: false,
    reason: `${moduleName} uses Provider API v${version}, which this AI Ecosystem no longer supports. Update ${moduleName}.`,
  };
}
