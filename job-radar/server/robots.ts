// Minimal robots.txt support (User-agent: * group, Allow/Disallow with * and $ wildcards).
// job-radar only fetches paths the site allows for all crawlers.

interface Rule {
  allow: boolean;
  re: RegExp;
  len: number;
}

const cache = new Map<string, Rule[]>();

function toRegex(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

export function parseRobots(txt: string): Rule[] {
  const rules: Rule[] = [];
  let inStar = false;
  let sawRuleInGroup = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (sawRuleInGroup) {
        inStar = false;
        sawRuleInGroup = false;
      }
      if (val === "*") inStar = true;
    } else if (key === "allow" || key === "disallow") {
      sawRuleInGroup = true;
      if (inStar && val) rules.push({ allow: key === "allow", re: toRegex(val), len: val.length });
    }
  }
  return rules;
}

export function isAllowed(rules: Rule[], url: string): boolean {
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best: Rule | undefined;
  for (const r of rules) {
    if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

export async function robotsFor(origin: string, fetcher: (url: string) => Promise<{ status: number; text: string }>) {
  if (!cache.has(origin)) {
    try {
      const res = await fetcher(`${origin}/robots.txt`);
      cache.set(origin, res.status === 200 ? parseRobots(res.text) : []);
    } catch {
      cache.set(origin, []);
    }
  }
  return cache.get(origin)!;
}
