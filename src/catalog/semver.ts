// Minimal semver helpers: numeric x.y.z comparison, missing parts count as 0.

function parts(version: string): { nums: number[]; pre: string } {
  const clean = version.trim().replace(/^v/i, "");
  const [core = "", ...rest] = clean.split("-");
  const nums = core
    .split("+")[0]
    .split(".")
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
  return { nums, pre: rest.join("-") };
}

/** Negative when a < b, 0 when equal, positive when a > b. A pre-release is lower than its release. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.nums.length, pb.nums.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export function isAtLeast(version: string, min: string): boolean {
  return compareVersions(version, min) >= 0;
}
