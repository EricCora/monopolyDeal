import '@testing-library/jest-dom';
import { afterEach } from 'vitest';

class ResizeObserverMock {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

// Tab-scoped state must not leak from one test into the next.
afterEach(() => {
  window.sessionStorage.clear();
});

// jsdom has no layout, and logs an error for scrollTo.
window.scrollTo = () => undefined;
