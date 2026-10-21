-- P318: the per-repo GitHub on/off setting becomes the git host provider choice.
UPDATE git_repo_settings
SET key = 'gitHostProvider', value = CASE WHEN value = 'false' THEN '"off"' ELSE '"auto"' END
WHERE key = 'githubEnabled';
