-- P259: hide repos from the Git panel list. ade_folders.hidden hides every repo a scan folder
-- imported and makes later discoveries in it import hidden.
ALTER TABLE code_repos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ade_folders ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
