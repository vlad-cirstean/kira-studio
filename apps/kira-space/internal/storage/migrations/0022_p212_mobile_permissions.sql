-- P212 Part 2: per-device write permissions. Both default off for rows that exist: those phones
-- were approved as read-only. New pairings set can_write at insert; can_agent_input is only ever
-- set from the desktop pane.
ALTER TABLE mobile_devices ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mobile_devices ADD COLUMN can_agent_input INTEGER NOT NULL DEFAULT 0;
