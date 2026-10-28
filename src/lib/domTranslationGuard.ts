/** Recover only detached text nodes inside Falcon's React root. */
export function installDomTranslationGuard(root: HTMLElement): void {
  const prototype = Node.prototype;
  const marker = Symbol.for("falcon.domTranslationGuard");
  const state = prototype as Node & { [key: symbol]: unknown };
  if (state[marker]) return;
  state[marker] = true;

  const removeChild = prototype.removeChild;
  const insertBefore = prototype.insertBefore;
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    // No text content or user information is included in diagnostics.
    console.warn("[Falcon DOM] Recovered an externally detached text node.");
  };
  const insideRoot = (parent: Node) => parent === root || root.contains(parent);

  prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.nodeType === Node.TEXT_NODE && child.parentNode !== this && insideRoot(this)) {
      report();
      return child;
    }
    return removeChild.call(this, child) as T;
  };

  prototype.insertBefore = function <T extends Node>(child: T, reference: Node | null): T {
    if (reference?.nodeType === Node.TEXT_NODE && reference.parentNode !== this && insideRoot(this)) {
      report();
      return insertBefore.call(this, child, null) as T;
    }
    return insertBefore.call(this, child, reference) as T;
  };
}