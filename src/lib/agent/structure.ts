// Reads resume text into a structure the export templates can lay out (REQ-AG-41). Extraction joins a
// right-aligned column onto its line ("Acme Corp Pittsburgh, PA"), so dates and locations at the end of a
// line are split back out here. Every block keeps its text exactly as written.

export type Block =
  | { kind: "name"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "heading"; text: string }
  /** An organisation (primary) or role/degree (secondary) line, with an optional right-hand date or location. */
  | { kind: "entry"; level: "primary" | "secondary"; left: string; right: string }
  | { kind: "bullet"; text: string }
  /** A "Label: text" line, as in a skills section. */
  | { kind: "labeled"; label: string; text: string }
  | { kind: "line"; text: string };

const BULLET = /^\s*[•▪◦‣∙·●○■□➢➤►✓✔\-*–—]\s+/;

const SECTION_NAME =
  /^(?:summary|profile|objective|(?:work |professional |relevant )?experience|employment(?: history)?|education|(?:technical )?skills?(?: (?:&|and) interests)?|interests|projects?(?: (?:&|and|\/) ventures)?|(?:leadership|volunteer)(?: experience)?|activities|certifications?(?: (?:&|and) licenses)?|licenses|awards|honors|publications|additional information|languages|(?:relevant )?coursework)$/i;

export function isHeading(line: string): boolean {
  const t = line.trim().replace(/:$/, "");
  if (t.length === 0 || t.length > 40) return false;
  if (SECTION_NAME.test(t)) return true;
  return /^[A-Z][A-Z &/,-]{2,}$/.test(t) && t.split(/\s+/).length <= 5;
}

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const SEASON = "(?:Spring|Summer|Fall|Autumn|Winter)";
const POINT = `(?:(?:${MONTH}|${SEASON})\\s+)?(?:19|20)\\d{2}|\\d{1,2}\\/(?:19|20)\\d{2}`;
const RANGE = `(?:${POINT})(?:\\s*[–—-]\\s*(?:${POINT}|Present|Current|Now|Today))?`;
const DATE_TAIL = new RegExp(`\\s+((?:(?:Expected|Anticipated|Graduated|Since)\\s+)?${RANGE})$`, "i");

const CITY_PREFIX =
  "(?:New|San|Los|Las|Santa|St\\.|Saint|Fort|Ft\\.|Salt Lake|Palo|Menlo|Redwood|Ann|Kansas|Oklahoma|Jersey|Long|Grand|Mountain|Baton|Des|El|Little|Silver|Bay|Cedar|Coral|Boca|Mount|Mt\\.|West|East|North|South|Hong|Tel|Rio de|Buenos|Mexico|Cape|Sao|São)";
// After "City, ": a state or country code, or a full US state or common country name. A bare capitalised word
// isn't enough ("Python, Excel" is a tech list, not a place).
const REGION =
  "[A-Z]{2,3}|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|" +
  "Canada|Mexico|Brazil|Argentina|Chile|Colombia|England|Scotland|Ireland|France|Germany|Spain|Portugal|Italy|Netherlands|Belgium|Switzerland|Austria|Sweden|Norway|Denmark|Finland|Poland|Israel|India|China|Japan|Korea|South Korea|Singapore|Australia|New Zealand|Vietnam|Thailand|Philippines|Indonesia|Kenya|Nigeria|Egypt|South Africa|United Kingdom|United States|Hong Kong|Taiwan|UAE";
const LOCATION_TAIL = new RegExp(`\\s+((?:${CITY_PREFIX}\\s)?[A-Z][A-Za-z.'’-]+,\\s(?:${REGION})|Remote|Hybrid)$`);

const LABELED = /^([A-Z][A-Za-z0-9 &/+.'’()-]{0,28}):\s+(.+)$/;

/** Splits a trailing date range or location off a line. Returns null when there is none. */
export function splitRight(line: string): { left: string; right: string; kind: "date" | "location" } | null {
  for (const [re, kind] of [[DATE_TAIL, "date"], [LOCATION_TAIL, "location"]] as const) {
    const m = re.exec(line);
    if (m && m.index > 0) {
      const left = line.slice(0, m.index).replace(/[\s|,·–—-]+$/, "");
      if (left) return { left, right: m[1].trim(), kind };
    }
  }
  return null;
}

export function parseResume(text: string): Block[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);
  const blocks: Block[] = [];
  let seenHeading = false;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (i === 0) return blocks.push({ kind: "name", text: line });
    if (BULLET.test(raw)) return blocks.push({ kind: "bullet", text: raw.replace(BULLET, "").trim() });
    if (isHeading(line)) {
      seenHeading = true;
      return blocks.push({ kind: "heading", text: line });
    }
    if (!seenHeading) return blocks.push({ kind: "contact", text: line.replace(/\t+/g, " ") });

    const labeled = LABELED.exec(line);
    if (labeled && labeled[1].trim().split(/\s+/).length <= 4) {
      return blocks.push({ kind: "labeled", label: labeled[1].trim(), text: labeled[2].trim() });
    }

    const prev = blocks[blocks.length - 1];
    const split = splitRight(line.replace(/\t+/g, " "));
    const afterBreak = !prev || prev.kind === "heading" || prev.kind === "bullet" || prev.kind === "labeled";
    const level = split?.kind === "location" || afterBreak ? "primary" : "secondary";
    blocks.push({ kind: "entry", level, left: split ? split.left : line.replace(/\t+/g, " "), right: split ? split.right : "" });
  });
  return blocks;
}
