-- chat_message: track the author for rate limiting + audit (nullable for
-- assistant rows conceptually, but we stamp the acting user on both).
alter table chat_message add column author_user_id uuid references app_user(id);
create index chat_message_author_idx on chat_message(author_user_id);
