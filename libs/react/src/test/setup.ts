import "@testing-library/jest-dom/vitest";

// rc-textarea reads layout properties before browser layout runs; jsdom returns
// zero for them and AntD turns that value into an invalid NaN height.
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    return 32;
  },
});
Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
  configurable: true,
  get() {
    return 320;
  },
});
