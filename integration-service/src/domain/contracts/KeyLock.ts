export interface KeyLock {
  /**
   * Runs `work` exclusively for the given key.
   * Implementations should guarantee best-effort mutual exclusion and must always release the lock.
   */
  withLock<T>(key: string, work: () => Promise<T>): Promise<T>;
}

