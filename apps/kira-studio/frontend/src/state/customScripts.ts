import { createCustomScriptsStore } from '@workbench/terminal/createCustomScriptsStore';
import { control } from '../bridge/control';

export const useCustomScriptsStore = createCustomScriptsStore(control);
