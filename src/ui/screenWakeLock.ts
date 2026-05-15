interface WakeLockSentinelLike extends EventTarget {
  released?: boolean;
  release(): Promise<void>;
}

interface WakeLockProviderLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

interface NavigatorWithWakeLock {
  wakeLock?: WakeLockProviderLike;
}

export interface ScreenWakeLockOptions {
  warn?: (message: string, error?: unknown) => void;
}

export class ScreenWakeLock {
  private desired = false;
  private pending?: Promise<void>;
  private sentinel?: WakeLockSentinelLike;
  private warnedUnexpectedError = false;
  private readonly warn?: (message: string, error?: unknown) => void;

  constructor(options: ScreenWakeLockOptions = {}) {
    this.warn = options.warn;

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      document.addEventListener("pointerdown", this.handleUserActivation, {
        capture: true,
        passive: true,
      });
      document.addEventListener("keydown", this.handleUserActivation, { capture: true });
    }

    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handlePageHide);
      window.addEventListener("pageshow", this.handleVisibilityChange);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.desired === enabled) {
      if (enabled) {
        void this.acquire();
      }
      return;
    }

    this.desired = enabled;

    if (enabled) {
      void this.acquire();
      return;
    }

    this.releaseCurrent();
  }

  requestFromUserGesture(enabled = true): void {
    if (!enabled) {
      return;
    }

    this.desired = true;
    void this.acquire();
  }

  dispose(): void {
    this.desired = false;
    this.releaseCurrent();

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      document.removeEventListener("pointerdown", this.handleUserActivation, { capture: true });
      document.removeEventListener("keydown", this.handleUserActivation, { capture: true });
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.handlePageHide);
      window.removeEventListener("pageshow", this.handleVisibilityChange);
    }
  }

  private acquire(): Promise<void> {
    if (!this.desired || !this.isDocumentVisible()) {
      return Promise.resolve();
    }

    if (this.sentinel && !this.sentinel.released) {
      return Promise.resolve();
    }

    const provider = this.getWakeLockProvider();
    if (!provider) {
      return Promise.resolve();
    }

    if (this.pending) {
      return this.pending;
    }

    this.pending = provider
      .request("screen")
      .then((sentinel) => {
        if (!this.desired || !this.isDocumentVisible()) {
          void sentinel.release().catch((error: unknown) => {
            this.reportUnexpectedError("Failed to release unused screen wake lock.", error);
          });
          return;
        }

        this.releaseCurrent();
        this.sentinel = sentinel;
        sentinel.addEventListener("release", this.handleSentinelRelease, { once: true });
      })
      .catch((error: unknown) => {
        this.reportAcquireError(error);
      })
      .finally(() => {
        this.pending = undefined;
      });

    return this.pending;
  }

  private releaseCurrent(): void {
    const sentinel = this.sentinel;
    this.sentinel = undefined;

    if (!sentinel || sentinel.released) {
      return;
    }

    sentinel.removeEventListener("release", this.handleSentinelRelease);
    void sentinel.release().catch((error: unknown) => {
      this.reportUnexpectedError("Failed to release screen wake lock.", error);
    });
  }

  private getWakeLockProvider(): WakeLockProviderLike | undefined {
    if (typeof navigator === "undefined") {
      return undefined;
    }

    return (navigator as unknown as NavigatorWithWakeLock).wakeLock;
  }

  private isDocumentVisible(): boolean {
    if (typeof document === "undefined") {
      return true;
    }

    return !document.hidden && document.visibilityState !== "hidden";
  }

  private reportAcquireError(error: unknown): void {
    const name = error instanceof DOMException ? error.name : undefined;
    if (name === "NotAllowedError" || name === "NotSupportedError") {
      return;
    }

    this.reportUnexpectedError("Failed to acquire screen wake lock.", error);
  }

  private reportUnexpectedError(message: string, error: unknown): void {
    if (this.warnedUnexpectedError) {
      return;
    }

    this.warnedUnexpectedError = true;
    this.warn?.(message, error);
  }

  private readonly handleVisibilityChange = () => {
    if (!this.isDocumentVisible()) {
      this.releaseCurrent();
      return;
    }

    if (this.desired) {
      void this.acquire();
    }
  };

  private readonly handlePageHide = () => {
    this.releaseCurrent();
  };

  private readonly handleUserActivation = () => {
    if (this.desired) {
      void this.acquire();
    }
  };

  private readonly handleSentinelRelease = () => {
    this.sentinel = undefined;

    if (this.desired && this.isDocumentVisible()) {
      void this.acquire();
    }
  };
}
