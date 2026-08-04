-- Client profile fields, populated at creation (admin "Add client") or intake.
alter table tenant add column org_type text check (org_type in ('nonprofit','startup'));
alter table tenant add column website text;
