// Three realistic sample funder applications, used until N4HC's real ones arrive.
//
// Every funder named here is FICTIONAL. The shapes are real: each one copies a
// pattern For Granted meets in practice, because those patterns are what the
// parser has to survive.
//
//   1. lakeshore  A community-foundation application, pasted from a portal.
//                 Numbered questions, word limits, a scoring rubric at the end
//                 that restates the questions in different words.
//   2. rfp        A long state-agency RFP, delivered as a PDF. Pages of
//                 boilerplate, questions in lettered sub-sections, CHARACTER
//                 limits "including spaces", a page limit that must stay a
//                 guidance note, and a question repeated in an appendix
//                 checklist. Long enough to need several windows.
//   3. loi        A family-foundation letter of inquiry form, delivered as Word.
//                 Short, unnumbered questions, one limit written as "250-word".
//
// `expected` is what a correct parse returns: the prompt as it appears in the
// source (the part a writer would call "the question"), and its limit.

export interface ExpectedQuestion { prompt: string; limit?: { value: number; unit: "words" | "characters" } }
export interface SampleApplication {
  key: string; format: "paste" | "pdf" | "docx"; title: string; funder: string;
  text: string; expected: ExpectedQuestion[]; attachments: string[];
}

const lakeshoreText = `LAKESHORE COMMUNITY FUND
2027 Access to Nature Grant: Student Transportation and Outdoor Learning
Application Form

Deadline: March 15, 2027 at 5:00 p.m. Eastern
Award range: $10,000 to $40,000 for one year
Eligibility: 501(c)(3) organizations, schools and public agencies serving students in Cuyahoga, Lake, Lorain or Summit County.

About this opportunity
The Access to Nature Grant helps young people in Northeast Ohio reach parks, preserves and outdoor classrooms. Transportation is the most common barrier teachers report, so this cycle gives priority to proposals that pay for buses, drivers or coordination that would not otherwise happen.

Instructions
Answer every question in the boxes provided. The portal counts words and will not accept answers over the limit. Do not attach narrative documents unless asked.

SECTION A: ORGANIZATION

1. Briefly describe your organization's mission and history. (150 words maximum)

2. Who does your organization serve? Describe the students, schools and neighborhoods you work with, including any data you collect on who participates. (250 words maximum)

SECTION B: THE PROJECT

3. Describe the need this project addresses. Why do the students you serve not reach outdoor learning today? (300 words maximum)

4. Describe the project. How many trips, for which students, to which destinations, and how will transportation be arranged? (400 words maximum)

5. List your partners for this project and describe the role each plays. Letters of commitment are encouraged but not required. (200 words maximum)

6. What will change for students as a result of this project, and how will you know? Include at least one measurable outcome. (300 words maximum)

SECTION C: CAPACITY AND SUSTAINABILITY

7. What experience does your organization have running field trips or transportation at this scale? (200 words maximum)

8. How will you continue this work after the grant period ends? (200 words maximum)

9. Describe how your organization reaches students who have historically had the least access to outdoor spaces. (200 words maximum)

SECTION D: BUDGET

10. Provide a brief budget narrative explaining how grant funds will be used. Upload the budget template separately. (150 words maximum)

Required attachments
- Completed project budget (Lakeshore template)
- IRS determination letter or proof of public agency status
- Most recent annual financial statement

How applications are scored
Reviewers score each application out of 100 points:
Need and population served (25 points): the case that these students lack access, supported by data.
Project design (25 points): a realistic plan for trips and transportation.
Outcomes and evaluation (20 points): clear, measurable change for students.
Partnerships (10 points): committed partners with defined roles.
Capacity and sustainability (20 points): evidence the organization can deliver and continue.

Questions? Contact grants@lakeshorecommunityfund.example.
`;

// ---------------------------------------------------------------------------

const boiler = (n: number) => [
  `${n}.1 Applicants must comply with all applicable state and federal laws, including but not limited to the requirements of the Uniform Administrative Requirements, Cost Principles, and Audit Requirements for Federal Awards at 2 CFR Part 200, as adopted by the Office. Failure to comply may result in the termination of an award and the recovery of funds.`,
  `${n}.2 All information submitted in response to this Request for Proposals becomes a public record upon award and may be released in accordance with the state public records law. Applicants should not include personal health information or other confidential information in any narrative response.`,
  `${n}.3 The Office reserves the right to reject any or all applications, to waive minor irregularities, to negotiate the scope of work and budget with any applicant, and to make partial awards. Submission of an application does not obligate the Office to make an award.`,
  `${n}.4 Applicants are responsible for all costs associated with preparing a response. Questions about this RFP must be submitted in writing to the RFP mailbox no later than the date listed in the timeline. Answers will be posted as an addendum and become part of this RFP.`,
  `${n}.5 Awards are contingent on the availability of state and federal funds. If funding is reduced during the project period, the Office may reduce the award amount, and the grantee will be asked to submit a revised budget and scope of work within thirty days of notice.`,
  `${n}.6 Grantees must maintain financial and programmatic records for a minimum of seven years following the close of the project period and make them available to the Office, the State Auditor, and any federal agency with oversight of the funds, upon request.`,
  `${n}.7 Grantees are prohibited from using award funds for lobbying, political activity, the purchase of real property, cash payments to participants, or any cost not directly related to the approved scope of work. Incentives of nominal value may be permitted with prior written approval.`,
  `${n}.8 The Office will not accept applications submitted by email, fax or mail. Applications must be submitted through the state grants management system before the deadline. Technical difficulties with the system do not extend the deadline unless the Office announces an outage in writing.`,
].join("\n\n");

const rfpText = `STATE OFFICE OF RURAL AND COMMUNITY HEALTH
Request for Proposals RFP-ORCH-2027-04
Community Health Access and Transportation Program (CHAT)
State Fiscal Year 2028

Release date: January 6, 2027
Letter of intent due: January 30, 2027
Applications due: February 27, 2027, 4:00 p.m.
Anticipated award amount: up to $250,000 per year for two years

SECTION 1: INTRODUCTION AND PURPOSE

The State Office of Rural and Community Health (the Office) announces the availability of funds to reduce transportation barriers to preventive care, behavioral health treatment and recovery support services. Funded projects will connect residents to care they would otherwise miss because of distance, cost or the absence of public transit, with particular attention to rural counties, people in recovery from substance use disorder, and young people.

The Office anticipates making between six and ten awards. Awards will be distributed to ensure geographic balance across the state's five health regions.

${boiler(1)}

SECTION 2: ELIGIBILITY

Eligible applicants are nonprofit organizations with 501(c)(3) status, local health departments, federally qualified health centers, and county boards of alcohol, drug addiction and mental health services. Applicants must be registered in SAM.gov and hold a Unique Entity Identifier at the time of application. For-profit entities may participate only as subcontractors.

${boiler(2)}

SECTION 3: PROGRAM REQUIREMENTS

Funded projects must provide or arrange non-emergency transportation, maintain a record of each trip by purpose and county, participate in the Office's quarterly learning collaborative, and submit quarterly performance reports using the template in Appendix C. Projects may not use funds for vehicle purchase exceeding 40 percent of the annual budget.

${boiler(3)}

SECTION 4: APPLICATION NARRATIVE

Complete each item below in the online application system. Each response box enforces the character limit shown, including spaces. Narrative text entered outside the boxes will not be reviewed.

4.A Organizational Capacity

4.A.1 Describe the applicant organization, its mission, and its experience delivering transportation or care-coordination services. (2,500 characters including spaces)

4.A.2 Describe the qualifications of the project director and key staff who will carry out this project. Attach resumes as Appendix D. (1,500 characters including spaces)

4.B Statement of Need

4.B.1 Using local data, describe the transportation barriers faced by the population to be served, including the counties and communities in the proposed service area. (3,000 characters including spaces)

4.B.2 Describe the health disparities experienced by the population to be served and how transportation contributes to them. (2,000 characters including spaces)

4.C Project Design

4.C.1 Describe the proposed transportation model, including how trips will be scheduled, who will provide rides, and how riders will be referred. (4,000 characters including spaces)

4.C.2 Describe your partnerships with health care providers, recovery support organizations, schools or transit authorities, and the role of each partner. Letters of support must be attached as Appendix E. (2,500 characters including spaces)

4.C.3 Provide a work plan with major activities, responsible parties and timelines for the two-year project period. The work plan may not exceed three pages and must be uploaded as Appendix F.

4.D Evaluation and Outcomes

4.D.1 Identify the measurable objectives your project will achieve by the end of each project year and the data you will collect to track them. (3,000 characters including spaces)

4.E Sustainability

4.E.1 Describe how the project will be sustained after state funding ends, including other funding sources you have secured or will pursue. (2,000 characters including spaces)

${boiler(4)}

SECTION 5: BUDGET

Applicants must complete the budget workbook in Appendix B for each project year and provide a budget justification that explains each line item. Indirect costs may not exceed 10 percent of direct costs unless the applicant holds a federally negotiated indirect cost rate agreement.

5.1 Provide a budget justification narrative that explains how each budget line supports the project activities described in Section 4. (3,000 characters including spaces)

${boiler(5)}

SECTION 6: REVIEW AND SCORING

Applications will be reviewed by a panel of Office staff and external reviewers. Each application will be scored out of 100 points as follows: Organizational Capacity 15 points; Statement of Need 25 points; Project Design 30 points; Evaluation and Outcomes 15 points; Sustainability 5 points; Budget 10 points. Applications scoring below 70 points will not be considered for funding.

${boiler(6)}

APPENDIX A: APPLICATION CHECKLIST

Before submitting, confirm that you have:
[ ] Completed every narrative box in Section 4
[ ] Described the transportation barriers faced by the population to be served (4.B.1)
[ ] Uploaded the budget workbook (Appendix B)
[ ] Uploaded resumes for key staff (Appendix D)
[ ] Uploaded letters of support (Appendix E)
[ ] Uploaded the work plan (Appendix F)
[ ] Uploaded the IRS determination letter or proof of public entity status
[ ] Confirmed active SAM.gov registration
`;

// ---------------------------------------------------------------------------

const loiText = `The Harlan and Ruth Okafor Family Foundation
Letter of Inquiry Form

The Foundation accepts letters of inquiry year round and reviews them quarterly. If your inquiry fits our priorities we will invite a full proposal. Please keep each answer within the limit shown.

Organization name
Contact person, title, email and phone
Amount requested

What is the purpose of your request? Please describe it in a 250-word summary.

How does this request connect to the Foundation's focus on children's health and time outdoors?
Limit: 200 words

What results do you expect, and how will you measure them?
Limit: 200 words

What is your organization's total annual operating budget, and what share of it does this request represent?

Who else is funding this work?

Is there anything else you would like the Foundation to know? (optional, 100 words)
`;

export const SAMPLES: SampleApplication[] = [
  {
    key: "lakeshore", format: "paste",
    title: "2027 Access to Nature Grant: Student Transportation and Outdoor Learning",
    funder: "Lakeshore Community Fund",
    text: lakeshoreText,
    attachments: ["Completed project budget", "IRS determination letter", "Most recent annual financial statement"],
    expected: [
      { prompt: "Briefly describe your organization's mission and history.", limit: { value: 150, unit: "words" } },
      { prompt: "Who does your organization serve? Describe the students, schools and neighborhoods you work with, including any data you collect on who participates.", limit: { value: 250, unit: "words" } },
      { prompt: "Describe the need this project addresses. Why do the students you serve not reach outdoor learning today?", limit: { value: 300, unit: "words" } },
      { prompt: "Describe the project. How many trips, for which students, to which destinations, and how will transportation be arranged?", limit: { value: 400, unit: "words" } },
      { prompt: "List your partners for this project and describe the role each plays.", limit: { value: 200, unit: "words" } },
      { prompt: "What will change for students as a result of this project, and how will you know?", limit: { value: 300, unit: "words" } },
      { prompt: "What experience does your organization have running field trips or transportation at this scale?", limit: { value: 200, unit: "words" } },
      { prompt: "How will you continue this work after the grant period ends?", limit: { value: 200, unit: "words" } },
      { prompt: "Describe how your organization reaches students who have historically had the least access to outdoor spaces.", limit: { value: 200, unit: "words" } },
      { prompt: "Provide a brief budget narrative explaining how grant funds will be used.", limit: { value: 150, unit: "words" } },
    ],
  },
  {
    key: "rfp", format: "pdf",
    title: "Community Health Access and Transportation Program (CHAT)",
    funder: "State Office of Rural and Community Health",
    text: rfpText,
    attachments: ["Budget workbook (Appendix B)", "Resumes (Appendix D)", "Letters of support (Appendix E)", "Work plan (Appendix F)"],
    expected: [
      { prompt: "Describe the applicant organization, its mission, and its experience delivering transportation or care-coordination services.", limit: { value: 2500, unit: "characters" } },
      { prompt: "Describe the qualifications of the project director and key staff who will carry out this project.", limit: { value: 1500, unit: "characters" } },
      { prompt: "Using local data, describe the transportation barriers faced by the population to be served, including the counties and communities in the proposed service area.", limit: { value: 3000, unit: "characters" } },
      { prompt: "Describe the health disparities experienced by the population to be served and how transportation contributes to them.", limit: { value: 2000, unit: "characters" } },
      { prompt: "Describe the proposed transportation model, including how trips will be scheduled, who will provide rides, and how riders will be referred.", limit: { value: 4000, unit: "characters" } },
      { prompt: "Describe your partnerships with health care providers, recovery support organizations, schools or transit authorities, and the role of each partner.", limit: { value: 2500, unit: "characters" } },
      { prompt: "Provide a work plan with major activities, responsible parties and timelines for the two-year project period." },
      { prompt: "Identify the measurable objectives your project will achieve by the end of each project year and the data you will collect to track them.", limit: { value: 3000, unit: "characters" } },
      { prompt: "Describe how the project will be sustained after state funding ends, including other funding sources you have secured or will pursue.", limit: { value: 2000, unit: "characters" } },
      { prompt: "Provide a budget justification narrative that explains how each budget line supports the project activities described in Section 4.", limit: { value: 3000, unit: "characters" } },
    ],
  },
  {
    key: "loi", format: "docx",
    title: "Letter of Inquiry",
    funder: "The Harlan and Ruth Okafor Family Foundation",
    text: loiText,
    attachments: [],
    expected: [
      { prompt: "What is the purpose of your request?", limit: { value: 250, unit: "words" } },
      { prompt: "How does this request connect to the Foundation's focus on children's health and time outdoors?", limit: { value: 200, unit: "words" } },
      { prompt: "What results do you expect, and how will you measure them?", limit: { value: 200, unit: "words" } },
      { prompt: "What is your organization's total annual operating budget, and what share of it does this request represent?" },
      { prompt: "Who else is funding this work?" },
      { prompt: "Is there anything else you would like the Foundation to know?", limit: { value: 100, unit: "words" } },
    ],
  },
];
