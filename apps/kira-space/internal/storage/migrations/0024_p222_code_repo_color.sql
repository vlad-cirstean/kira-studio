ALTER TABLE code_repos ADD COLUMN color TEXT NOT NULL DEFAULT 'none';
UPDATE code_repos SET color = CASE sort_order % 6
  WHEN 0 THEN 'blue' WHEN 1 THEN 'amber' WHEN 2 THEN 'magenta'
  WHEN 3 THEN 'green' WHEN 4 THEN 'red' ELSE 'cyan' END;
