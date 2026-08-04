-- Per-client visibility of each Story Intelligence artifact. Admins toggle it;
-- clients only see (and can navigate to) types where their set is visible.
alter table artifact_set add column client_visible boolean not null default true;
