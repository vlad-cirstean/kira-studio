import { createAppMetricsStore } from '@workbench/state/createAppMetricsStore';
import { control } from '../bridge/control';

// P116 G7: body hoisted to createAppMetricsStore.ts (H6), unchanged — this app now has its own
// metrics ticker (main.go's own metrics.NewAppTicker("Kira Space")).
export const useAppMetricsStore = createAppMetricsStore(control);
