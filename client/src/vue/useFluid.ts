import { ref, shallowRef, onUnmounted, type Ref, type ShallowRef } from 'vue';
import {
  FeeBumpRequestInput,
  FeeBumpResponse,
  FluidClient,
} from '../FluidClient';

export interface UseFluidResult {
  requestFeeBump: (
    transaction: FeeBumpRequestInput,
    submit?: boolean
  ) => Promise<FeeBumpResponse>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  result: ShallowRef<FeeBumpResponse | null>;
}

export function useFluid(client: FluidClient): UseFluidResult {
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  const result = shallowRef<FeeBumpResponse | null>(null);

  // Track in-flight requests for cleanup
  let abortController: AbortController | null = null;

  const requestFeeBump = async (
    transaction: FeeBumpRequestInput,
    submit: boolean = false
  ): Promise<FeeBumpResponse> => {
    // Cancel any previous in-flight request
    if (abortController) {
      abortController.abort();
    }

    // Create new abort controller for this request
    abortController = new AbortController();

    isLoading.value = true;
    error.value = null;

    try {
      const response = await client.requestFeeBump(transaction, submit);
      
      // Only update state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        result.value = response;
      }
      
      return response;
    } catch (caughtError) {
      // Only update error state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        const normalizedError =
          caughtError instanceof Error
            ? caughtError
            : new Error('Failed to request fee bump');

        error.value = normalizedError;
        result.value = null;
        throw normalizedError;
      }
      
      // If aborted, re-throw the original error
      throw caughtError;
    } finally {
      // Only update loading state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        isLoading.value = false;
      }
    }
  };

  // Cleanup on unmount
  onUnmounted(() => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  });

  return {
    requestFeeBump,
    isLoading,
    error,
    result,
  };
}
