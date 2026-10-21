-- P312: panel sizes are per module; the one shared value seeds every module.
INSERT OR IGNORE INTO ui_layout (key, value)
SELECT 'modes.' || m.mode || '.project.width', l.value
FROM (SELECT 'git' AS mode UNION ALL SELECT 'automations' AS mode UNION ALL SELECT 'ade' AS mode UNION ALL SELECT 'memory' AS mode) m, ui_layout l WHERE l.key = 'panel.project.width';
DELETE FROM ui_layout WHERE key IN ('panel.project.width');
