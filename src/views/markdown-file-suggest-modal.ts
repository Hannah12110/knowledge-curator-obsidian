import { FuzzySuggestModal, TFile } from "obsidian";
import type { App } from "obsidian";

export class MarkdownFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("选择要检查的 Markdown 文件");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
