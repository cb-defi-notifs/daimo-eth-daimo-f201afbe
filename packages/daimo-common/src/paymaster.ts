import { Address } from "viem";

export type ChainGasConstants = {
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  preVerificationGas: string;

  /* Estimated fee in dollars (2 digits after decimal) */
  estimatedFee: number;
  paymasterAddress: Address;
};

export const DEFAULT_USEROP_VERIFICATION_GAS_LIMIT = 700000n;
export const DEFAULT_USEROP_CALL_GAS_LIMIT = 300000n;
