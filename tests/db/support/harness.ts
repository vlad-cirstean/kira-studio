/// <reference types="bun-types" />

// Thin import shim so swapping bun:test for @playwright/test is a one-file change (P1 risk register).
export { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
