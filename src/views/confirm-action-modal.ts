import { App, Modal } from "obsidian";

export interface ConfirmActionOptions {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export class ConfirmActionModal extends Modal {
  constructor(app: App, private readonly options: ConfirmActionOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.options.title });
    contentEl.createEl("p", { text: this.options.message });
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelButton = actions.createEl("button", { text: "取消" });
    const confirmButton = actions.createEl("button", {
      cls: this.options.destructive ? "mod-warning" : "mod-cta",
      text: this.options.confirmText
    });
    cancelButton.addEventListener("click", () => this.close());
    confirmButton.addEventListener("click", () => {
      confirmButton.disabled = true;
      cancelButton.disabled = true;
      void Promise.resolve(this.options.onConfirm())
        .finally(() => this.close());
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
