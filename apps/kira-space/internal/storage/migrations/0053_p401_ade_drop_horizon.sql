-- P401: the plan window is fixed at 7 days; drop the stored horizon and extra-day leaves.
DELETE FROM settings WHERE key IN ('ade.horizonDays', 'ade.extraDays');
