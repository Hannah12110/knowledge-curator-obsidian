// A small event-capable host double for testing the real sidebar rendering.
export class UiNode {
  children: UiNode[] = [];
  attributes: Record<string, string> = {};
  classes = new Set<string>();
  listeners = new Map<string, Array<(event: any) => void>>();
  disabled = false;
  checked = false; indeterminate = false; open = false;
  style: Record<string, string> = {};
  parent: UiNode | null = null;
  private pointer: number | null = null;
  scrollTop = 0;
  focused = false;
  constructor(public tag = "div", public ownText = "") {}
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(" "); }
  empty(): void { this.children = []; this.ownText = ""; }
  addClass(...names: string[]): void { names.forEach((name) => this.classes.add(name)); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  createEl(tag: string, options: any = {}): UiNode {
    const node = new UiNode(tag, options.text ?? "");
    String(options.cls ?? "").split(" ").filter(Boolean).forEach((name) => node.classes.add(name));
    Object.assign(node.attributes, options.attr ?? {}); node.parent = this; this.children.push(node); return node;
  }
  createDiv(options?: any): UiNode { return this.createEl("div", options); }
  createSpan(options?: any): UiNode { return this.createEl("span", options); }
  addEventListener(name: string, listener: (event: any) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  dispatch(name: string, event: any = {}): void { event.target ??= this; event.preventDefault ??= () => undefined; event.stopPropagation ??= () => undefined; if (!this.disabled) this.listeners.get(name)?.forEach((listener) => listener(event)); }
  closest(selector: string): UiNode | null { return selector.split(",").map((tag) => tag.trim()).includes(this.tag) ? this : this.parent?.closest(selector) ?? null; }
  setPointerCapture(id: number): void { this.pointer = id; }
  hasPointerCapture(id: number): boolean { return this.pointer === id; }
  releasePointerCapture(_id: number): void { this.pointer = null; }
  focus(): void { this.focused = true; }
  all(): UiNode[] { return [this, ...this.children.flatMap((child) => child.all())]; }
  querySelector(selector: string): UiNode | undefined { return this.all().find((node) => node.attributes.id === selector.slice(1)); }
}
export class ItemView { contentEl = new UiNode(); constructor(public leaf: unknown) {} }
export class WorkspaceLeaf {}
export class App {}
export class Notice { constructor(_message: string) {} }
export class TFile {}
export class TFolder {}
export class Vault {}
export class MetadataCache {}
export function normalizePath(value: string): string { return value.replace(/\\/gu, "/"); }
export function setIcon(_element: unknown, _name: string): void {}
export async function requestUrl(): Promise<never> { throw new Error("Unexpected real requestUrl call in tests."); }
