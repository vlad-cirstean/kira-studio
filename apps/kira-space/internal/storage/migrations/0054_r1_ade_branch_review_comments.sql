-- R1-M3: review comments of a branch row, kept when the row is archived or detached so a later task
-- reusing the branch name starts a fresh review session. NULL = no snapshot taken.
ALTER TABLE ade_task_branches ADD COLUMN review_comments TEXT;
