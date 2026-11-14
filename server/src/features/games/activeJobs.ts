const activeJobs = new Map<string, number>();

export function tryStartActiveJob(gameId: string): boolean {
  if (activeJobs.has(gameId)) {
    return false;
  }
  activeJobs.set(gameId, Date.now());
  return true;
}

export function finishActiveJob(gameId: string): void {
  activeJobs.delete(gameId);
}

export function hasActiveJob(gameId: string): boolean {
  return activeJobs.has(gameId);
}

export function clearActiveJobsForTests(): void {
  activeJobs.clear();
}

export async function waitForActiveJobToFinish(gameId: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (hasActiveJob(gameId)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for active job ${gameId}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
