import { describe, it, expect } from "vitest";
import {
  speakerTurns, speakerLabels, looksLikeTranscript, speakerAt,
  isFirstPerson, attributeSubject, describeRoster, type SpeakerRoster,
} from "@/lib/transcript-speakers";

/** The real shape of RE-Assist's transcripts: anonymous, numbered speakers. */
const CALL = `Speaker 1  (00:01)
Then, have you died?

Speaker 2  (00:02)
Good good. It's so nice to meet you and see you now in person.

Speaker 1  (00:30)
Yeah, greater mesham. I know about your story, Tyler, so congratulations on moving forward with your startup.

Speaker 1  (00:44)
I've, you know, mentored and seen and advised and reviewed hundreds and hundreds of companies and pitch presentations

Speaker 2  (01:02)
We built the prototype with my son during COVID to help vulnerable patients navigate the system.
`;

const ROSTER: SpeakerRoster = {
  chars: CALL.length,
  speakers: [
    { label: "Speaker 1", isClient: false, name: "Howie", evidence: "congratulations on moving forward with your startup" },
    { label: "Speaker 2", isClient: true, name: "Ashley", evidence: "We built the prototype with my son" },
  ],
};

describe("finding the turns", () => {
  it("reads the anonymous numbered form the transcripts actually use", () => {
    expect(speakerLabels(CALL)).toEqual(["Speaker 1", "Speaker 2"]);
  });

  it("reads named speakers too, with or without a timestamp", () => {
    const named = "Ashley Barrow (00:12):\nWe launched last year.\n\nShane:\nHow many sites?\n";
    expect(speakerLabels(named)).toEqual(["Ashley Barrow", "Shane"]);
  });

  it("does not mistake a sentence containing a colon for a speaker", () => {
    const prose = "The plan has three parts, and this is the first: expand into Kentucky.\n";
    expect(speakerLabels(prose)).toEqual([]);
  });

  it("says a proposal is not a transcript, so it is left alone entirely", () => {
    expect(looksLikeTranscript("A five-year partnership with Bon Secours Mercy Health.")).toBe(false);
    expect(looksLikeTranscript(CALL)).toBe(true);
  });

  it("places a position with the speaker who was talking at the time", () => {
    const turns = speakerTurns(CALL);
    expect(speakerAt(turns, CALL.indexOf("mentored"))).toBe("Speaker 1");
    expect(speakerAt(turns, CALL.indexOf("We built the prototype"))).toBe("Speaker 2");
    expect(speakerAt(turns, 0)).toBe("Speaker 1");
  });
});

describe("first person", () => {
  it("catches the pronouns that make a claim the speaker's own", () => {
    expect(isFirstPerson("I've mentored hundreds of companies")).toBe(true);
    expect(isFirstPerson("We built the prototype")).toBe(true);
    expect(isFirstPerson("my son")).toBe(true);
  });

  it("leaves a third-person statement about the client alone", () => {
    // An outsider describing the client is still a fact about the client.
    expect(isFirstPerson("They have a five-year partnership with Mercy")).toBe(false);
    expect(isFirstPerson("RE-Assist serves discharged patients")).toBe(false);
  });
});

describe("attributeSubject", () => {
  const turns = speakerTurns(CALL);
  const call = (quote: string, subject: "organization" | "third_party" = "organization") =>
    attributeSubject({ quote, subject, turns, roster: ROSTER, offset: CALL.indexOf(quote) });

  it("THE REGRESSION: an outsider's own career stops being the client's evidence", () => {
    const q = "I've, you know, mentored and seen and advised and reviewed hundreds and hundreds of companies";
    const r = call(q);
    expect(r.subject).toBe("third_party");
    expect(r.reattributed).toBe(true);
  });

  it("leaves the client's own first-person claim as the client's", () => {
    const r = call("We built the prototype with my son during COVID");
    expect(r.subject).toBe("organization");
    expect(r.reattributed).toBe(false);
  });

  it("leaves an outsider's third-person statement about the client alone", () => {
    // Said by Speaker 1, who is not the client, but it is about the client.
    const r = call("congratulations on moving forward with your startup");
    expect(r.subject).toBe("organization");
  });

  it("does nothing without a roster, so a document we could not read is unchanged", () => {
    const q = "I've, you know, mentored";
    expect(attributeSubject({
      quote: q, subject: "organization", turns, roster: null, offset: CALL.indexOf(q),
    }).subject).toBe("organization");
  });

  it("does nothing for a speaker the roster could not place", () => {
    const unsure: SpeakerRoster = {
      chars: CALL.length,
      speakers: [{ label: "Speaker 1", name: null, evidence: null }],
    };
    const q = "I've, you know, mentored";
    expect(attributeSubject({
      quote: q, subject: "organization", turns, roster: unsure, offset: CALL.indexOf(q),
    }).subject).toBe("organization");
  });

  it("never moves a fact TOWARDS the organization", () => {
    // The only direction this rule travels. It can remove a false claim and
    // must never be able to manufacture one.
    const r = call("I've mentored hundreds of companies", "third_party");
    expect(r.subject).toBe("third_party");
    expect(r.reattributed).toBe(false);
  });

  it("does nothing when the quote cannot be located in the text", () => {
    expect(attributeSubject({
      quote: "a quote from somewhere else", subject: "organization",
      turns, roster: ROSTER, offset: -1,
    }).subject).toBe("organization");
  });
});

describe("describeRoster", () => {
  it("says what was found, in words a person can check", () => {
    expect(describeRoster(ROSTER, "Ashley Intro Call"))
      .toBe("2 speaker(s) in Ashley Intro Call: 1 from the client, 1 from outside.");
  });

  it("counts the ones it could not place", () => {
    const r: SpeakerRoster = {
      chars: 10,
      speakers: [...ROSTER.speakers, { label: "Speaker 3", name: null, evidence: null }],
    };
    expect(describeRoster(r, "Call")).toContain("1 unplaced");
  });
});
