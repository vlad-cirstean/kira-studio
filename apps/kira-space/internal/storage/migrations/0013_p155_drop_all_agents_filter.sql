-- P155: ade.allAgentsFilter left the settings model (R19); its row is orphaned.
DELETE FROM settings WHERE key = 'ade.allAgentsFilter';
