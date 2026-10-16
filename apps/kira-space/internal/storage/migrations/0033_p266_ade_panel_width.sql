-- P266: ADE panel width is app-wide geometry, not a preference; move the stored leaf to layout.
INSERT OR REPLACE INTO ui_layout (key, value) SELECT 'panel.ade.width', value FROM settings WHERE key = 'ade.panelWidth';
DELETE FROM settings WHERE key = 'ade.panelWidth';
