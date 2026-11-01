import '@testing-library/jest-dom';

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
