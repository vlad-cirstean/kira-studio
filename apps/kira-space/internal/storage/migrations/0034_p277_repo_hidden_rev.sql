-- P277: hidden_rev counts writes of code_repos.hidden, so a folder scan applies its hidden flag only
-- to repos nobody changed since the scan imported them.
ALTER TABLE code_repos ADD COLUMN hidden_rev INTEGER NOT NULL DEFAULT 0;
