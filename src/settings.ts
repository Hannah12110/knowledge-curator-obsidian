import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type KnowledgeCuratorPlugin from "./main";
import type { AnalysisPreferences } from "./types/settings";
import { ConfirmActionModal } from "./views/confirm-action-modal";

export class KnowledgeCuratorSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: KnowledgeCuratorPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("知识范围").setHeading();
    this.text("待处理目录", "放入要整理的文章。也可直接选择原始资料目录中的文章。", "raw", this.plugin.settings.inboxFolder, (value) => { this.plugin.settings.inboxFolder = value; });
    new Setting(containerEl).setName("原始资料目录").setDesc("每行一个库内目录；Wiki 必须与这些目录分开。")
      .addTextArea((text) => text.setValue(this.plugin.settings.rawFolders.join("\n")).setPlaceholder("raw").onChange((value) => {
        this.plugin.settings.rawFolders = [...new Set(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))]; this.save();
      }));
    this.text("Wiki 目录", "一键分析会将可维护的知识增量写入这里。请使用独立的库内目录。", "wiki", this.plugin.settings.wikiFolder, (value) => { this.plugin.settings.wikiFolder = value; });

    new Setting(containerEl).setName("AI 服务").setHeading();
    this.text("LLM Base URL", "兼容 OpenAI 的 AI 服务地址。", "https://api.example.com/v1", this.plugin.settings.llmBaseUrl, (value) => { this.plugin.settings.llmBaseUrl = value; });
    this.text("LLM API Key", "密钥保存在当前库的插件设置中；请勿公开该配置文件。", "API Key", this.plugin.settings.llmApiKey, (value) => { this.plugin.settings.llmApiKey = value; }, true);
    this.text("LLM 模型", "填写 AI 服务支持的模型名称。", "模型名称", this.plugin.settings.llmModel, (value) => { this.plugin.settings.llmModel = value; });
    containerEl.createEl("p", { cls: "setting-item-description", text: "分析时仅会将当前文章和少量相关知识发送到你配置的 AI 服务，不会上传整个 Vault。更新知识索引时，会逐篇发送配置 Wiki 内需要重新提取的文档。" });
    const external = containerEl.createEl("details");
    external.createEl("summary", { text: "外部核验（可选）" });
    new Setting(external).setName("搜索 API Key").setDesc("填写 Tavily 密钥后，发现冲突或高时效风险时可检索外部证据；仅发送相关查询。未配置时保留本地判断，不宣称已完成外部核验。")
      .addText((text) => { text.inputEl.type = "password"; text.setValue(this.plugin.settings.searchApiKey).onChange((value) => { this.plugin.settings.searchApiKey = value.trim(); this.save(); }); });

    new Setting(containerEl).setName("分析偏好").setHeading();
    containerEl.createEl("p", { text: "质量、冲突和重复结果来自同一次文章分析，开关控制展示与后续独立核验；写入仍执行完整安全校验。自动更新和关系生成需要先提取知识点。首次分析会自动建立知识索引，可能需要一些时间。", cls: "setting-item-description" });
    const choices: Array<[keyof AnalysisPreferences, string, string]> = [
      ["quality", "内容质量", "显示内容质量判断。"], ["conflicts", "知识冲突", "显示冲突并在已配置搜索服务时核验。"],
      ["duplicates", "重复知识", "显示与已有知识的重复判断。"], ["freshness", "时效性问题", "进行本地风险判断，并核验相关的高风险已有知识。"],
      ["extractKnowledge", "提取知识点", "关闭后也会暂停自动更新和关系生成。"], ["updateWiki", "更新知识库", "通过路径、来源及变更校验后自动写入 Wiki 并保留更新记录。"],
      ["generateRelations", "生成知识关系思维导图", "基于现有知识索引生成关系；不自动合并或删除文档。"]
    ];
    for (const [key, label, description] of choices) new Setting(containerEl).setName(label).setDesc(description)
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.analysisPreferences[key]).onChange((value) => { this.plugin.settings.analysisPreferences[key] = value; this.save(); }));

    new Setting(containerEl).setName("知识维护").setHeading();
    new Setting(containerEl).setName("更新知识索引").setDesc("重新扫描 Wiki，更新用于知识检索的本地索引。不会修改知识文档；首次提取需要调用 AI 服务。")
      .addButton((button) => button.setButtonText("更新知识索引").setDisabled(this.plugin.isWorkflowBusy()).onClick(async () => {
        button.setDisabled(true); button.setButtonText("正在更新…");
        try {
          const result = await this.plugin.buildClaimStore(false);
          new Notice(result.stats.failedFiles > 0 ? `部分索引未完成，${result.stats.failedFiles} 篇文档可稍后重试。` : `知识索引已更新：${result.stats.totalClaims} 个知识点。`);
        } catch (error) { console.error("Knowledge Curator index update failed", error); new Notice("知识索引更新失败，请检查 AI 服务配置后重试。"); }
        finally { this.display(); }
      }));
    new Setting(containerEl).setName("清除分析缓存").setDesc("清除文章分析与核验缓存，保留知识索引、更新记录和知识文档。")
      .addButton((button) => button.setButtonText("清除分析缓存").setDisabled(this.plugin.isWorkflowBusy()).onClick(() => {
        new ConfirmActionModal(this.app, { title: "清除分析缓存", message: "下次分析会重新请求 AI 服务。知识文档和更新记录不受影响。", confirmText: "确认清除", onConfirm: async () => {
          if (this.plugin.isWorkflowBusy()) { new Notice("请等待文章分析完成后清除缓存。"); return; }
          try {
            await this.plugin.clearAnalysisCache(); await this.plugin.clearComparisonCache(); await this.plugin.clearVerificationCache();
            await this.plugin.clearFreshnessVerificationCache(); await this.plugin.clearDraftPRCache();
            new Notice("分析缓存已清除。");
          } catch (error) { console.error("Knowledge Curator cache clear failed", error); new Notice("部分缓存未能清除，请稍后重试。"); }
        } }).open();
      }));
  }
  private save(): void { void this.plugin.saveSettings().then(() => this.plugin.refreshSidebarState()); }
  private text(name: string, description: string, placeholder: string, value: string, update: (value: string) => void, secret = false): void {
    new Setting(this.containerEl).setName(name).setDesc(description).addText((text) => {
      if (secret) text.inputEl.type = "password";
      text.setPlaceholder(placeholder).setValue(value).onChange((next) => { update(next.trim()); this.save(); });
    });
  }
}
