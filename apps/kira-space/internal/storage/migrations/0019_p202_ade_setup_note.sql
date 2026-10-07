-- P202: why a worktree setup failed, shown wherever the setup is.
ALTER TABLE ade_worktree_setup ADD COLUMN note TEXT NOT NULL DEFAULT '';
