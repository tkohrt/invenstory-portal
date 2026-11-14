// State names for the geographic blocker (patch 44). Pure data: full names to
// postal codes, so restriction phrasing like "Ohio-based organizations" can be
// resolved against a client's state_code and service_area.
export const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

const NAME_PATTERN = Object.keys(STATE_NAME_TO_CODE).sort((a, b) => b.length - a.length).join("|");

/** Every US state named in a text, as postal codes, deduped. Full names only:
    bare two-letter codes collide with too much English ("IN", "OR", "ME"). */
export function statesNamed(text: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(`\\b(${NAME_PATTERN})\\b`, "gi");
  for (const m of text.matchAll(re)) out.add(STATE_NAME_TO_CODE[m[1].toLowerCase()]);
  return [...out];
}
