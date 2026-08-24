/**
 * Reducing a people-data response to the part a buyer reads first.
 *
 * The supplier returns everything it holds — descriptions running to
 * paragraphs, full skill inventories, education histories. That is worth
 * having and stays in the payload untouched. But an agent that asked "who
 * works here" needs the answer in a shape it can act on, and a human skimming
 * the response should not have to hunt for a name.
 *
 * Nothing is invented and nothing is dropped: this is a table of contents for
 * data the buyer already has.
 */

export interface PersonSummary {
  name: string;
  /** Their own words for what they do there. */
  headline: string | null;
  location: string | null;
  profile: string | null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function place(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const l = v as Record<string, unknown>;
  const parts = [text(l["city"]), text(l["region"]), text(l["country"])].filter(
    (p): p is string => p !== null,
  );
  // A country repeated as its own region reads as a mistake, not detail.
  const seen = [...new Set(parts)];
  return seen.length > 0 ? seen.join(", ") : null;
}

function profileUrl(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const social = v as Record<string, unknown>;
  for (const entry of Object.values(social)) {
    if (entry && typeof entry === "object") {
      const url = text((entry as Record<string, unknown>)["url"]);
      if (url) return url;
    }
  }
  return null;
}

export interface PeopleSummary {
  count: number;
  people: PersonSummary[];
}

export function summarisePeople(raw: unknown): PeopleSummary | null {
  const outer = (raw ?? {}) as Record<string, unknown>;
  const list = outer["people"] ?? outer["results"] ?? outer["data"];
  if (!Array.isArray(list)) return null;

  const people = list.flatMap((row): PersonSummary[] => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const name =
      text(r["full_name"]) ??
      [text(r["first_name"]), text(r["last_name"])].filter(Boolean).join(" ").trim();
    if (!name) return [];
    return [
      {
        name,
        headline: text(r["headline"]),
        location: place(r["location"]),
        profile: profileUrl(r["social_profiles"]),
      },
    ];
  });

  return { count: people.length, people };
}
