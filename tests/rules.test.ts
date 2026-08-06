/**
 * Rule lexicon integrity + category behavior on canonical provision texts.
 *
 * These snippets are the lexicon's regression suite: each states an expected
 * category for a realistic piece of statutory language. When rules are
 * edited, these must keep passing.
 */

import { describe, expect, it } from "vitest";

import { classifyProvisions } from "@/lib/classify";
import { loadRules } from "@/lib/rules";
import { CATEGORIES } from "@/lib/types";

const rules = loadRules();

function categories(text: string): Set<string> {
  const matches = classifyProvisions([{ provisionId: "P001", heading: "", text }], rules);
  return new Set(matches.map((m) => m.category));
}

describe("lexicon integrity", () => {
  it("loads a valid lexicon covering all categories", () => {
    expect(rules.length).toBeGreaterThanOrEqual(30);
    expect(new Set(rules.map((r) => r.category))).toEqual(new Set(CATEGORIES));
    const ids = rules.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("is deterministic across loads", () => {
    const a = loadRules();
    const b = loadRules();
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });
});

describe("restrictive", () => {
  it("strict photo ID", () => {
    expect(
      categories(
        "Each voter shall present valid photographic identification issued by the state " +
          "before receiving a ballot. A voter who does not present such identification " +
          "shall not be issued a ballot.",
      ),
    ).toEqual(new Set(["restrictive"]));
  });

  it("proof of citizenship", () => {
    expect(
      categories(
        "An applicant shall provide documentary proof of United States citizenship at the " +
          "time of registration.",
      ),
    ).toEqual(new Set(["restrictive"]));
  });

  it("purge for not voting", () => {
    expect(
      categories(
        "The county clerk shall cancel the registration of any elector who has failed to " +
          "vote in two consecutive general elections and failed to respond to a " +
          "confirmation notice.",
      ),
    ).toEqual(new Set(["restrictive"]));
  });

  it("ballot collection ban", () => {
    expect(
      categories(
        "It is unlawful for any person to knowingly collect or deliver another person's " +
          "voted or unvoted absentee ballot, except for a family member or household member.",
      ),
    ).toContain("restrictive");
  });

  it("witness requirement", () => {
    expect(
      categories(
        "The statement on the return envelope of an absentee ballot shall be witnessed by " +
          "two adults or notarized.",
      ),
    ).toContain("restrictive");
  });

  it("same-day registration repeal", () => {
    expect(
      categories("The provisions authorizing same-day voter registration are repealed effective January 1."),
    ).toEqual(new Set(["restrictive"]));
  });

  // Direction inversions: repealing a convenience must never code expansive.
  it("AVR repeal is restrictive, not expansive", () => {
    expect(
      categories("The provisions establishing automatic voter registration are repealed."),
    ).toEqual(new Set(["restrictive"]));
  });

  it("preregistration repeal is restrictive, not expansive", () => {
    expect(
      categories(
        "The department shall discontinue preregistration of persons sixteen years of age.",
      ),
    ).toEqual(new Set(["restrictive"]));
  });

  it("online registration repeal is restrictive, not expansive", () => {
    expect(categories("Online voter registration is hereby repealed.")).toEqual(
      new Set(["restrictive"]),
    );
  });

  it("curbside voting ban is restrictive, not expansive", () => {
    expect(
      categories(
        "Curbside voting is prohibited; every voter shall enter the polling place to cast a ballot.",
      ),
    ).toEqual(new Set(["restrictive"]));
  });

  it("cure elimination is restrictive, not expansive", () => {
    expect(
      categories(
        "The opportunity to cure a signature defect on an absentee ballot envelope is eliminated.",
      ),
    ).toEqual(new Set(["restrictive"]));
  });

  it("drop box cap", () => {
    expect(
      categories(
        "A county shall provide no more than one drop box regardless of population, and " +
          "drop boxes shall be located only at the office of the county clerk.",
      ),
    ).toContain("restrictive");
  });
});

describe("expansive", () => {
  it("automatic registration", () => {
    expect(
      categories(
        "The department of motor vehicles shall automatically register to vote each " +
          "eligible applicant unless the applicant declines.",
      ),
    ).toEqual(new Set(["expansive"]));
  });

  it("same-day registration", () => {
    expect(
      categories(
        "A qualified elector may complete same-day voter registration at the polling place " +
          "and cast a ballot in that election.",
      ),
    ).toEqual(new Set(["expansive"]));
  });

  it("rights restoration", () => {
    expect(
      categories(
        "A person convicted of a felony shall have the right to vote restored upon release " +
          "from incarceration.",
      ),
    ).toEqual(new Set(["expansive"]));
  });

  it("cure process", () => {
    expect(
      categories(
        "The registrar shall notify the voter of any signature deficiency and provide an " +
          "opportunity to cure the defect on the absentee ballot envelope no later than " +
          "noon on the third day.",
      ),
    ).toContain("expansive");
  });

  it("drop box expansion", () => {
    expect(
      categories(
        "The governing body shall establish at least one drop box for the return of marked " +
          "absentee ballots in each county.",
      ),
    ).toEqual(new Set(["expansive"]));
  });
});

describe("election interference", () => {
  it("criminal penalties on officials", () => {
    expect(
      categories(
        "Any election official who sends an absentee ballot application to a voter who has " +
          "not requested one is guilty of a felony of the third degree.",
      ),
    ).toContain("election_interference");
  });

  it("protecting officials is NOT interference", () => {
    expect(
      categories(
        "Any person who threatens or intimidates an election official or election worker " +
          "in the performance of official duties is guilty of a felony.",
      ),
    ).not.toContain("election_interference");
  });

  it("partisan takeover", () => {
    expect(
      categories(
        "The State Election Board may suspend and remove a county election superintendent " +
          "and appoint an individual to assume control of county election administration.",
      ),
    ).toContain("election_interference");
  });

  it("certification interference", () => {
    expect(
      categories(
        "The board of canvassers may decline to certify the results of an election pending " +
          "an investigation of alleged irregularities.",
      ),
    ).toContain("election_interference");
  });

  it("risk-limiting audits are NOT interference", () => {
    expect(
      categories(
        "The secretary of state shall conduct a risk-limiting audit of at least one " +
          "statewide contest after each general election.",
      ),
    ).not.toContain("election_interference");
  });
});

describe("neutral", () => {
  it("unrelated bill", () => {
    expect(
      categories(
        "The segment of State Route 12 between mile marker 4 and mile marker 9 is hereby " +
          "designated the Veterans Memorial Highway. The department shall erect suitable markers.",
      ),
    ).toEqual(new Set());
  });

  it("technical cleanup", () => {
    expect(
      categories(
        "The term 'general registrar' is substituted for 'registrar' throughout Title 24.2 " +
          "to conform terminology; no substantive change is intended.",
      ),
    ).toEqual(new Set());
  });
});
