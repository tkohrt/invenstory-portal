// Countries and world regions, for Funding Eligibility outside the United
// States (international eligibility, patch 1 of the 1 November 2026 build).
//
// Pure and free of `server-only` so the screen and the form share one list and
// it can be unit tested. Codes are ISO 3166-1 alpha-2 (plus XK, Kosovo, which
// funders use). Names are the short English forms funders write, so a name can
// be searched for in an opportunity's own text.
//
// Regions follow the UN M49 sub-regions, which is how most development funders
// and multilaterals describe where they give ("East Africa", "West Africa").

export const COUNTRIES: readonly (readonly [string, string])[] = [
  ["AD", "Andorra"], ["AE", "United Arab Emirates"], ["AF", "Afghanistan"], ["AG", "Antigua and Barbuda"],
  ["AI", "Anguilla"], ["AL", "Albania"], ["AM", "Armenia"], ["AO", "Angola"],
  ["AQ", "Antarctica"], ["AR", "Argentina"], ["AS", "American Samoa"], ["AT", "Austria"],
  ["AU", "Australia"], ["AW", "Aruba"], ["AX", "Åland Islands"], ["AZ", "Azerbaijan"],
  ["BA", "Bosnia and Herzegovina"], ["BB", "Barbados"], ["BD", "Bangladesh"], ["BE", "Belgium"],
  ["BF", "Burkina Faso"], ["BG", "Bulgaria"], ["BH", "Bahrain"], ["BI", "Burundi"],
  ["BJ", "Benin"], ["BL", "St. Barthélemy"], ["BM", "Bermuda"], ["BN", "Brunei"],
  ["BO", "Bolivia"], ["BQ", "Caribbean Netherlands"], ["BR", "Brazil"], ["BS", "Bahamas"],
  ["BT", "Bhutan"], ["BV", "Bouvet Island"], ["BW", "Botswana"], ["BY", "Belarus"],
  ["BZ", "Belize"], ["CA", "Canada"], ["CC", "Cocos (Keeling) Islands"], ["CD", "Democratic Republic of the Congo"],
  ["CF", "Central African Republic"], ["CG", "Republic of the Congo"], ["CH", "Switzerland"], ["CI", "Côte d'Ivoire"],
  ["CK", "Cook Islands"], ["CL", "Chile"], ["CM", "Cameroon"], ["CN", "China"],
  ["CO", "Colombia"], ["CR", "Costa Rica"], ["CU", "Cuba"], ["CV", "Cape Verde"],
  ["CW", "Curaçao"], ["CX", "Christmas Island"], ["CY", "Cyprus"], ["CZ", "Czechia"],
  ["DE", "Germany"], ["DJ", "Djibouti"], ["DK", "Denmark"], ["DM", "Dominica"],
  ["DO", "Dominican Republic"], ["DZ", "Algeria"], ["EC", "Ecuador"], ["EE", "Estonia"],
  ["EG", "Egypt"], ["EH", "Western Sahara"], ["ER", "Eritrea"], ["ES", "Spain"],
  ["ET", "Ethiopia"], ["FI", "Finland"], ["FJ", "Fiji"], ["FK", "Falkland Islands"],
  ["FM", "Micronesia"], ["FO", "Faroe Islands"], ["FR", "France"], ["GA", "Gabon"],
  ["GB", "United Kingdom"], ["GD", "Grenada"], ["GE", "Georgia"], ["GF", "French Guiana"],
  ["GG", "Guernsey"], ["GH", "Ghana"], ["GI", "Gibraltar"], ["GL", "Greenland"],
  ["GM", "Gambia"], ["GN", "Guinea"], ["GP", "Guadeloupe"], ["GQ", "Equatorial Guinea"],
  ["GR", "Greece"], ["GS", "South Georgia and South Sandwich Islands"], ["GT", "Guatemala"], ["GU", "Guam"],
  ["GW", "Guinea-Bissau"], ["GY", "Guyana"], ["HK", "Hong Kong"], ["HM", "Heard and McDonald Islands"],
  ["HN", "Honduras"], ["HR", "Croatia"], ["HT", "Haiti"], ["HU", "Hungary"],
  ["ID", "Indonesia"], ["IE", "Ireland"], ["IL", "Israel"], ["IM", "Isle of Man"],
  ["IN", "India"], ["IO", "British Indian Ocean Territory"], ["IQ", "Iraq"], ["IR", "Iran"],
  ["IS", "Iceland"], ["IT", "Italy"], ["JE", "Jersey"], ["JM", "Jamaica"],
  ["JO", "Jordan"], ["JP", "Japan"], ["KE", "Kenya"], ["KG", "Kyrgyzstan"],
  ["KH", "Cambodia"], ["KI", "Kiribati"], ["KM", "Comoros"], ["KN", "St. Kitts and Nevis"],
  ["KP", "North Korea"], ["KR", "South Korea"], ["KW", "Kuwait"], ["KY", "Cayman Islands"],
  ["KZ", "Kazakhstan"], ["LA", "Laos"], ["LB", "Lebanon"], ["LC", "St. Lucia"],
  ["LI", "Liechtenstein"], ["LK", "Sri Lanka"], ["LR", "Liberia"], ["LS", "Lesotho"],
  ["LT", "Lithuania"], ["LU", "Luxembourg"], ["LV", "Latvia"], ["LY", "Libya"],
  ["MA", "Morocco"], ["MC", "Monaco"], ["MD", "Moldova"], ["ME", "Montenegro"],
  ["MF", "St. Martin"], ["MG", "Madagascar"], ["MH", "Marshall Islands"], ["MK", "North Macedonia"],
  ["ML", "Mali"], ["MM", "Myanmar"], ["MN", "Mongolia"], ["MO", "Macao"],
  ["MP", "Northern Mariana Islands"], ["MQ", "Martinique"], ["MR", "Mauritania"], ["MS", "Montserrat"],
  ["MT", "Malta"], ["MU", "Mauritius"], ["MV", "Maldives"], ["MW", "Malawi"],
  ["MX", "Mexico"], ["MY", "Malaysia"], ["MZ", "Mozambique"], ["NA", "Namibia"],
  ["NC", "New Caledonia"], ["NE", "Niger"], ["NF", "Norfolk Island"], ["NG", "Nigeria"],
  ["NI", "Nicaragua"], ["NL", "Netherlands"], ["NO", "Norway"], ["NP", "Nepal"],
  ["NR", "Nauru"], ["NU", "Niue"], ["NZ", "New Zealand"], ["OM", "Oman"],
  ["PA", "Panama"], ["PE", "Peru"], ["PF", "French Polynesia"], ["PG", "Papua New Guinea"],
  ["PH", "Philippines"], ["PK", "Pakistan"], ["PL", "Poland"], ["PM", "St. Pierre and Miquelon"],
  ["PN", "Pitcairn Islands"], ["PR", "Puerto Rico"], ["PS", "Palestine"], ["PT", "Portugal"],
  ["PW", "Palau"], ["PY", "Paraguay"], ["QA", "Qatar"], ["RE", "Réunion"],
  ["RO", "Romania"], ["RS", "Serbia"], ["RU", "Russia"], ["RW", "Rwanda"],
  ["SA", "Saudi Arabia"], ["SB", "Solomon Islands"], ["SC", "Seychelles"], ["SD", "Sudan"],
  ["SE", "Sweden"], ["SG", "Singapore"], ["SH", "St. Helena"], ["SI", "Slovenia"],
  ["SJ", "Svalbard and Jan Mayen"], ["SK", "Slovakia"], ["SL", "Sierra Leone"], ["SM", "San Marino"],
  ["SN", "Senegal"], ["SO", "Somalia"], ["SR", "Suriname"], ["SS", "South Sudan"],
  ["ST", "São Tomé and Príncipe"], ["SV", "El Salvador"], ["SX", "Sint Maarten"], ["SY", "Syria"],
  ["SZ", "Eswatini"], ["TC", "Turks and Caicos Islands"], ["TD", "Chad"], ["TF", "French Southern Territories"],
  ["TG", "Togo"], ["TH", "Thailand"], ["TJ", "Tajikistan"], ["TK", "Tokelau"],
  ["TL", "Timor-Leste"], ["TM", "Turkmenistan"], ["TN", "Tunisia"], ["TO", "Tonga"],
  ["TR", "Türkiye"], ["TT", "Trinidad and Tobago"], ["TV", "Tuvalu"], ["TW", "Taiwan"],
  ["TZ", "Tanzania"], ["UA", "Ukraine"], ["UG", "Uganda"], ["UM", "US Outlying Islands"],
  ["US", "United States"], ["UY", "Uruguay"], ["UZ", "Uzbekistan"], ["VA", "Vatican City"],
  ["VC", "St. Vincent and Grenadines"], ["VE", "Venezuela"], ["VG", "British Virgin Islands"], ["VI", "U.S. Virgin Islands"],
  ["VN", "Vietnam"], ["VU", "Vanuatu"], ["WF", "Wallis and Futuna"], ["WS", "Samoa"],
  ["XK", "Kosovo"], ["YE", "Yemen"], ["YT", "Mayotte"], ["ZA", "South Africa"],
  ["ZM", "Zambia"], ["ZW", "Zimbabwe"],];

export const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map(([c, n]) => [c, n]));

export function isCountryCode(v: unknown): v is string {
  return typeof v === "string" && v in COUNTRY_NAME;
}

export function countryName(code: string | null | undefined): string | null {
  return code ? COUNTRY_NAME[code] ?? null : null;
}

/** Countries sorted for a picker, the United States first. */
export const COUNTRY_OPTIONS: { v: string; l: string }[] = [
  { v: "US", l: "United States" },
  ...COUNTRIES.filter(([c]) => c !== "US").map(([c, n]) => ({ v: c, l: n }))
    .sort((a, b) => a.l.localeCompare(b.l)),
];

/**
 * Other names funders use for a country, so a notice that says "DRC" or
 * "Ivory Coast" still counts as naming it. Lower case; matched on word edges.
 */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["usa", "u.s.", "united states of america"],
  GB: ["uk", "britain", "great britain", "england", "scotland", "wales", "northern ireland"],
  CD: ["drc", "dr congo", "congo-kinshasa", "congo, democratic republic"],
  CG: ["congo-brazzaville", "congo, republic"],
  CI: ["ivory coast", "cote d'ivoire", "côte d’ivoire"],
  TZ: ["tanzania, united republic"],
  SZ: ["swaziland"],
  MM: ["burma"],
  TR: ["turkey"],
  CZ: ["czech republic"],
  KR: ["republic of korea", "korea, republic"],
  PS: ["west bank", "gaza", "palestinian territories"],
  CV: ["cape verde", "cabo verde"],
  TL: ["east timor"],
  MK: ["macedonia"],
};

export interface Region { key: string; label: string; members: readonly string[] }

export const REGIONS: readonly Region[] = [
  { key: "east_africa", label: "East Africa", members: ["BI", "KM", "DJ", "ER", "ET", "KE", "MG", "MW", "MU", "MZ", "RE", "RW", "SC", "SO", "SS", "TZ", "UG", "YT", "ZM", "ZW"] },
  { key: "west_africa", label: "West Africa", members: ["BJ", "BF", "CV", "CI", "GM", "GH", "GN", "GW", "LR", "ML", "MR", "NE", "NG", "SH", "SN", "SL", "TG"] },
  { key: "central_africa", label: "Central Africa", members: ["AO", "CM", "CF", "TD", "CG", "CD", "GQ", "GA", "ST"] },
  { key: "southern_africa", label: "Southern Africa", members: ["BW", "SZ", "LS", "NA", "ZA"] },
  { key: "north_africa", label: "North Africa", members: ["DZ", "EG", "LY", "MA", "SD", "TN", "EH"] },
  { key: "middle_east", label: "Middle East", members: ["AE", "AM", "AZ", "BH", "CY", "GE", "IQ", "IL", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"] },
  { key: "south_asia", label: "South Asia", members: ["AF", "BD", "BT", "IN", "IR", "LK", "MV", "NP", "PK"] },
  { key: "southeast_asia", label: "Southeast Asia", members: ["BN", "KH", "ID", "LA", "MM", "MY", "PH", "SG", "TH", "TL", "VN"] },
  { key: "east_asia", label: "East Asia", members: ["CN", "HK", "JP", "KP", "KR", "MN", "MO", "TW"] },
  { key: "central_asia", label: "Central Asia", members: ["KZ", "KG", "TJ", "TM", "UZ"] },
  { key: "europe", label: "Europe", members: ["AD", "AL", "AT", "AX", "BA", "BE", "BG", "BY", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "FO", "FR", "GB", "GG", "GI", "GR", "HR", "HU", "IE", "IM", "IS", "IT", "JE", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SJ", "SK", "SM", "UA", "VA", "XK"] },
  { key: "latin_america", label: "Latin America and the Caribbean", members: ["AG", "AI", "AR", "AW", "BB", "BL", "BO", "BQ", "BR", "BS", "BZ", "CL", "CO", "CR", "CU", "CW", "DM", "DO", "EC", "FK", "GD", "GF", "GP", "GT", "GY", "HN", "HT", "JM", "KN", "KY", "LC", "MF", "MQ", "MS", "MX", "NI", "PA", "PE", "PR", "PY", "SR", "SV", "SX", "TC", "TT", "UY", "VC", "VE", "VG", "VI"] },
  { key: "north_america", label: "North America", members: ["US", "CA", "BM", "GL", "PM"] },
  { key: "oceania", label: "Oceania and the Pacific", members: ["AS", "AU", "CK", "FJ", "FM", "GU", "KI", "MH", "MP", "NC", "NF", "NR", "NU", "NZ", "PF", "PG", "PN", "PW", "SB", "TK", "TO", "TV", "UM", "VU", "WF", "WS"] },
  { key: "global", label: "Global (many countries)", members: [] },
];

export const REGION_LABEL: Record<string, string> = Object.fromEntries(REGIONS.map(r => [r.key, r.label]));

export function isRegionKey(v: unknown): v is string {
  return typeof v === "string" && v in REGION_LABEL;
}

/** The regions a country sits in (one, except where M49 overlaps). */
export function regionsOf(code: string): string[] {
  return REGIONS.filter(r => r.members.includes(code)).map(r => r.key);
}

/** Wider names a funder may use for a region, matched as well as the label. */
export const REGION_ALIASES: Record<string, string[]> = {
  east_africa: ["eastern africa", "horn of africa", "sub-saharan africa", "africa"],
  west_africa: ["western africa", "sahel", "sub-saharan africa", "africa"],
  central_africa: ["middle africa", "sub-saharan africa", "africa"],
  southern_africa: ["sub-saharan africa", "africa"],
  north_africa: ["northern africa", "mena", "africa"],
  middle_east: ["mena", "western asia"],
  south_asia: ["southern asia", "asia"],
  southeast_asia: ["south-east asia", "asean", "asia"],
  east_asia: ["eastern asia", "asia"],
  central_asia: ["asia"],
  latin_america: ["latin america", "caribbean", "central america", "south america", "lac"],
  oceania: ["pacific", "pacific islands"],
  global: ["global", "worldwide", "international", "all countries"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does this text name the place, by name or a known alias? Word edges, any case. */
export function textNames(text: string, names: string[]): string | null {
  const t = text.toLowerCase();
  for (const n of names) {
    const k = n.toLowerCase().trim();
    if (k.length < 2) continue;
    if (new RegExp(`(^|[^a-z])${escapeRe(k)}($|[^a-z])`, "i").test(t)) return n;
  }
  return null;
}

/** Every name a country can appear under in an opportunity's text. */
export function countryNames(code: string): string[] {
  const n = COUNTRY_NAME[code];
  return n ? [n, ...(COUNTRY_ALIASES[code] ?? [])] : [];
}

/** Every name a region can appear under. */
export function regionNames(key: string): string[] {
  const label = REGION_LABEL[key];
  return label ? [label, ...(REGION_ALIASES[key] ?? [])] : [];
}
