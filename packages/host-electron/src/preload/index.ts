/**
 * `contextBridge` surface, nothing more (P3 W11, §3.1's own annotation on this file). All the
 * logic lives in `kiraBridge.ts`, which is exercised directly in unit tests via fake
 * `ipcRenderer`/`contextBridge` objects — this file only wires the two real Electron singletons
 * into it.
 */
import { contextBridge, ipcRenderer } from "electron";
import { installKiraBridge } from "./kiraBridge.ts";

installKiraBridge(ipcRenderer, contextBridge);
