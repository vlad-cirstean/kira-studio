import { errorText } from '@workbench/bridge/codedError';
import { control } from '../../../bridge/control';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useLaunchOpener } from './useLaunchOpener';

/** Opens launches a phone started in this window, the way a desktop click would, and answers the
 *  server, which waits for the terminal before it tells the phone. */
export function installMobileLaunch(): () => void {
  return control.onMobileOpenLaunch(async (event) => {
    let failure = '';
    try {
      await useLaunchOpener().open(event.launch);
      useAdeBoardUiStore().openSession({
        taskId: event.taskId,
        branchId: event.branchId,
        sessionId: event.launch.sessionId,
      });
    } catch (err) {
      failure = errorText(err);
    }
    await control.mobileLaunchOpened(event.launch.terminalId, failure).catch(() => {
      // The phone gives up waiting on its own when this answer cannot be delivered.
    });
  });
}
