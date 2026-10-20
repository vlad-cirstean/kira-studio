-- P316: claudeCode.* settings move under agent.*; the per-provider memory.models replaces memory.claudeModel.
UPDATE settings SET key = 'agent.' || substr(key, length('claudeCode.') + 1) WHERE key LIKE 'claudeCode.%';
DELETE FROM settings WHERE key = 'memory.claudeModel';
