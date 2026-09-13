import type {
  GitClient,
  GitPairingSnapshot,
  GitVsixInstallResult,
  GitVsixStatus,
} from '@shared/domain/git';
import { reactive } from 'vue';
import { control } from '../bridge/control';

// G1 §4.1: the single module-level store both the pairing dialog and the Connected editors pane
// read. PendingPairing() at boot is what implements SPEC §3.3's "held with no Kira Studio window
// open yet" from the renderer's side (D8) — the request already exists server-side; this is only
// the first render of it.
//
// G10 D14: `vsix` joins the same store — fetched in the same boot-time Promise.all as
// clients/pending below, and re-read after every installVsCodeIntegration() call (an install can
// flip nothing about codeAvailable, but a failure message must be replaced on the next attempt).
const DEFAULT_VSIX_STATUS: GitVsixStatus = {
  bundled: false,
  vsixPath: '',
  codeAvailable: false,
  probed: [],
};

export const gitClientsState = reactive({
  clients: [] as GitClient[],
  pending: null as GitPairingSnapshot['pending'],
  queued: 0,
  vsix: DEFAULT_VSIX_STATUS as GitVsixStatus,
  vsixInstallResult: null as GitVsixInstallResult | null,
});

function applySnapshot(snap: GitPairingSnapshot): void {
  gitClientsState.pending = snap.pending;
  gitClientsState.queued = snap.queued;
}

let unsubscribePairing: (() => void) | null = null;
let unsubscribeClients: (() => void) | null = null;

export async function hydrateGitClients(): Promise<void> {
  const [clients, pending, vsix] = await Promise.all([
    control.gitClientsList(),
    control.gitPairingPending(),
    control.gitVsixStatus(),
  ]);
  gitClientsState.clients = clients;
  applySnapshot(pending);
  gitClientsState.vsix = vsix;

  unsubscribePairing?.();
  unsubscribePairing = control.onGitPairingChanged(applySnapshot);
  unsubscribeClients?.();
  unsubscribeClients = control.onGitClientsChanged((clients) => {
    gitClientsState.clients = clients;
  });
}

// approve/deny let the emitted kira:git:pairing event drive the re-render (D9: an
// "alreadyResolved" answer is not an error path — the pending snapshot simply clears when the
// event arrives, whichever window's click actually won).
export async function approvePairing(requestId: string): Promise<void> {
  await control.gitPairingApprove(requestId);
}

export async function denyPairing(requestId: string): Promise<void> {
  await control.gitPairingDeny(requestId);
}

export async function revokeGitClient(id: string): Promise<void> {
  await control.gitClientsRevoke(id);
}

// G10 D14: re-reads VsixStatus afterward — an install can leave codeAvailable unchanged, but a
// stale failure message must be replaced (or cleared) on the next attempt regardless of outcome.
export async function installVsCodeIntegration(): Promise<void> {
  const result = await control.gitVsixInstall();
  gitClientsState.vsixInstallResult = result;
  gitClientsState.vsix = await control.gitVsixStatus();
}
