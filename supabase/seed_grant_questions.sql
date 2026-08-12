-- Starter question bank (For Granted IP). Idempotent by slug.
insert into public.grant_question (slug, category, prompt_text, guidance, audience, sort_order) values
-- Universal
('org-overview','Organization overview & mission','Provide a concise overview of your organization and its mission.','Who you are, when you started, the mission in one or two sentences, and the core of what you do.','both',10),
('leadership','Leadership, team & capacity','Describe your leadership and key team members, and the organization''s capacity to deliver.','Names, roles, relevant experience; why this team can execute.','both',80),
('use-of-funds','Amount requested & use of funds','What amount are you requesting and how will the funds be used?','A clear budget narrative: total ask and the main categories of use.','both',120),
-- Nonprofit
('need','Statement of need','What is the problem or need your organization addresses?','The gap, its scale, who is affected, and evidence it matters.','nonprofit',20),
('who-you-serve','Who you serve & geography','Who do you serve, and in what geography?','Population served, eligibility, and the communities/region covered.','nonprofit',30),
('program','Program description','Describe the program or services this request would support.','What you do, how it works, and what a participant experiences.','nonprofit',40),
('goals','Goals & measurable objectives','What are your goals and measurable objectives?','Specific, measurable objectives with targets and timeframe.','nonprofit',50),
('outcomes','Outcomes, impact & evaluation','What outcomes and impact have you achieved, and how do you evaluate them?','Results to date, metrics, and your evaluation approach.','nonprofit',60),
('history','Organization history & capacity','Summarize your organization''s history and track record.','Founding, milestones, and evidence of your ability to deliver.','nonprofit',70),
('financial','Financial overview','Provide a financial overview of your organization.','Annual budget, major revenue sources, and financial health.','nonprofit',90),
('sustainability','Sustainability & future funding','How will this work be sustained beyond this grant?','Diversified funding, earned revenue, and long-term plan.','nonprofit',100),
('partnerships','Partnerships','What key partnerships support this work?','Collaborators, their roles, and what they add.','nonprofit',110),
-- Startup
('problem','Statement of need','What problem are you solving?','The pain point, who has it, and why it matters now.','startup',20),
('solution','Program description','What is your solution or product?','What you''ve built, how it works, and why it''s differentiated.','startup',40),
('market','Who you serve & market','Who is your customer and how large is the market?','Target customer, market size (TAM/SAM/SOM), and demand signals.','startup',30),
('traction','Outcomes, impact & traction','What traction have you achieved to date?','Users, revenue, growth, pilots, or other proof points.','startup',60),
('business-model','Financial overview & business model','What is your business model?','How you make money, pricing, and unit economics.','startup',90),
('competition','Partnerships & competition','Who are your competitors and how do you differentiate?','The landscape and your durable advantage.','startup',110),
('milestones','Sustainability & milestones','What milestones will this funding help you reach?','Key milestones, timeline, and what success looks like.','startup',100)
on conflict (slug) do nothing;
