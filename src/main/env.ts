import { app } from 'electron';

/** Unpackaged means development or test — the only place the dev menu and DevTools exist. */
export const isDevBuild = !app.isPackaged;
