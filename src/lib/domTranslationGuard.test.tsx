import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomTranslationGuard } from "./domTranslationGuard";

describe("translation DOM recovery", () => {
  const remove = Node.prototype.removeChild;
  const insert = Node.prototype.insertBefore;
  const root = document.createElement("div");
  let warning: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    document.body.appendChild(root);
    warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    installDomTranslationGuard(root);
  });
  afterAll(() => {
    Node.prototype.removeChild = remove;
    Node.prototype.insertBefore = insert;
    Reflect.deleteProperty(Node.prototype, Symbol.for("falcon.domTranslationGuard"));
    root.remove();
    warning.mockRestore();
  });

  it("keeps ordinary removal and ordered insertion unchanged", () => {
    const parent = document.createElement("div");
    root.appendChild(parent);
    const text = parent.appendChild(document.createTextNode("original"));
    const added = document.createElement("span");
    expect(parent.insertBefore(added, text)).toBe(added);
    expect(parent.firstChild).toBe(added);
    expect(parent.removeChild(text)).toBe(text);
    parent.remove();
  });

  it("recovers removal of a text node replaced by a translator", () => {
    const parent = document.createElement("div");
    root.appendChild(parent);
    const text = parent.appendChild(document.createTextNode("original"));
    parent.replaceChild(document.createElement("font"), text);
    expect(parent.removeChild(text)).toBe(text);
    parent.remove();
  });

  it("inserts a new node when the text reference was detached", () => {
    const parent = document.createElement("div");
    root.appendChild(parent);
    const text = document.createTextNode("detached");
    const added = document.createElement("span");
    expect(parent.insertBefore(added, text)).toBe(added);
    expect(added.parentNode).toBe(parent);
    parent.remove();
  });

  it("does not hide invalid element operations or errors outside Falcon", () => {
    const parent = document.createElement("div");
    root.appendChild(parent);
    expect(() => parent.removeChild(document.createElement("span"))).toThrow();
    expect(() => parent.insertBefore(document.createElement("span"), document.createElement("span"))).toThrow();
    const outside = document.createElement("div");
    expect(() => outside.removeChild(document.createTextNode("absent"))).toThrow();
    expect(() => outside.insertBefore(document.createElement("span"), document.createTextNode("absent"))).toThrow();
    parent.remove();
  });

  it("installs once without stacking wrappers", () => {
    const installed = Node.prototype.removeChild;
    installDomTranslationGuard(root);
    expect(Node.prototype.removeChild).toBe(installed);
  });

  it("allows a React transition after translation replaces conditional text", async () => {
    const container = document.createElement("div");
    root.appendChild(container);
    const reactRoot = createRoot(container);
    const view = (visible: boolean) => <div>{visible && "conditional"}<span>stable</span></div>;
    await act(async () => reactRoot.render(view(true)));
    const parent = container.firstChild;
    const text = parent?.firstChild;
    if (!parent || !text) throw new Error("React did not render the fixture");
    const translated = document.createElement("font");
    translated.textContent = "translated";
    parent.replaceChild(translated, text);
    await act(async () => reactRoot.render(view(false)));
    expect(container.querySelector("span")?.textContent).toBe("stable");
    await act(async () => reactRoot.unmount());
    container.remove();
  });
});