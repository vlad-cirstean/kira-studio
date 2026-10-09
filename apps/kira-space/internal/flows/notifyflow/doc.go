// Package notifyflow drives desktop agent notifications (P238) through the real composition root:
// hook events arrive over the hooks socket via the real shim, runs through the ADE board, and the
// OS sink is a recorder. No test calls the Notifier directly.
package notifyflow
