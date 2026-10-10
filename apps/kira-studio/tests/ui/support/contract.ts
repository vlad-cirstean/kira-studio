import { resolve } from 'node:path';
import { createContract } from '@workbench/testing/ui/contract';

// Fixtures the Go flow tests write and assert: apps/kira-studio/tests/contract/<scenario>.json.
export const contract = createContract(resolve(__dirname, '../../contract'));
