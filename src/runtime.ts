import type { CapabilityUI } from '@capability-ui/core';
import type { CupStore } from './cup-store.js';
import type { LanguageModel } from './provider.js';

/** Shared bag so capabilities registered at CUP construction can see the
 * live cup instance and model once the CLI/loop has created them. */
export interface HarnessRuntime {
  store?: CupStore;
  model?: LanguageModel;
  cup?: CapabilityUI;
}
