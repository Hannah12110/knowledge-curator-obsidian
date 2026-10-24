import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type KnowledgeCuratorPlugin from "./main";
import { ConfirmActionModal } from "./views/confirm-action-modal";
import {
  CLAIM_GRAPH_RELEASE_NOTICE,
  COMPRESSION_RELEASE_NOTICE
} from "./knowledge/claim-graph-release-boundary";

export class KnowledgeCuratorSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: KnowledgeCuratorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("知识范围")
      .setHeading();
    new Setting(containerEl)
      .setName("运行模式")
      .setDesc("测试模式仅允许写入隔离测试 Wiki；正式知识库预览允许分析、验证和生成建议，但禁止接受写入。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("test", "测试模式")
          .addOption("production-preview", "正式知识库预览（只读）")
          .setValue(this.plugin.settings.mode)
          .onChange((value) => {
            this.plugin.settings.mode = value === "production-preview"
              ? "production-preview"
              : "test";
            void this.plugin.saveSettings();
            this.plugin.refreshSidebarState();
          });
      });
    this.addTextSetting("待处理目录", "存放待处理文章的目录。", "inbox", this.plugin.settings.inboxFolder, (value) => {
      this.plugin.settings.inboxFolder = value;
    });
    new Setting(containerEl)
      .setName("原始资料目录")
      .setDesc("支持多个目录，每行填写一个 Vault 相对路径。")
      .addTextArea((text) => {
        text
          .setPlaceholder("raw-技术\nraw-产品")
          .setValue(this.plugin.settings.rawFolders.join("\n"))
          .onChange((value) => {
            this.plugin.settings.rawFolders = this.parseFolderList(value);
            void this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
      });
    this.addTextSetting("Wiki 目录", "存放结构化知识条目的目录。", "wiki", this.plugin.settings.wikiFolder, (value) => {
      this.plugin.settings.wikiFolder = value;
    });

    new Setting(containerEl)
      .setName("LLM")
      .setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "分析时仅向配置的 LLM 服务发送当前文章和召回到的少量相关 Wiki / Raw，不会上传整个 Vault。"
    });
    this.addTextSetting("LLM Base URL", "兼容 OpenAI API 的服务地址。", "https://api.example.com/v1", this.plugin.settings.llmBaseUrl, (value) => {
      this.plugin.settings.llmBaseUrl = value;
    });
    this.addTextSetting("LLM API Key", "所配置服务商的 API Key。", "sk-…", this.plugin.settings.llmApiKey, (value) => {
      this.plugin.settings.llmApiKey = value;
    }, true);
    this.addTextSetting("LLM 模型", "调用 OpenAI-compatible API 时使用的模型标识。", "model-name", this.plugin.settings.llmModel, (value) => {
      this.plugin.settings.llmModel = value;
    });

    new Setting(containerEl)
      .setName("检索")
      .setHeading();
    new Setting(containerEl)
      .setName("Claim Comparison")
      .setDesc("Claim Mode 使用本地 Claim Store 做知识点级比较；Legacy Document Mode 保留原 Phase 2 流程用于回退。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("claim", "Claim Mode")
          .addOption("legacy", "Legacy Document Mode")
          .setValue(this.plugin.settings.claimComparisonMode)
          .onChange((value) => {
            this.plugin.settings.claimComparisonMode = value === "legacy" ? "legacy" : "claim";
            void this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Claim Retrieval Top K")
      .setDesc("每条 Candidate Claim 最多发送给模型的 Existing Claims，范围 3～10，默认 5。")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.claimRetrievalTopK))
          .onChange((value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
              this.plugin.settings.claimRetrievalTopK = Math.min(10, Math.max(3, parsed));
              void this.plugin.saveSettings();
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "3";
        text.inputEl.max = "10";
      });
    new Setting(containerEl)
      .setName("最大相关笔记数")
      .setDesc("每次分析最多召回的 Wiki 和 Raw 总数，范围 1～20。")
      .addText((text) => {
        text
          .setPlaceholder("8")
          .setValue(String(this.plugin.settings.maxRelatedNotes))
          .onChange((value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
              this.plugin.settings.maxRelatedNotes = Math.min(20, Math.max(1, parsed));
              void this.plugin.saveSettings();
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "20";
      });

    new Setting(containerEl)
      .setName("搜索")
      .setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "仅在 Phase 2 检测到冲突并由你点击验证时调用 Tavily，不会为普通文章自动联网。"
    });
    new Setting(containerEl)
      .setName("Search Provider")
      .setDesc("Phase 4 MVP 固定使用 Tavily。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("tavily", "Tavily")
          .setValue(this.plugin.settings.searchProvider)
          .onChange((value) => {
            if (value === "tavily") {
              this.plugin.settings.searchProvider = value;
              void this.plugin.saveSettings();
            }
          });
      });
    this.addTextSetting(
      "Search API Key",
      "仅发送给 Tavily Search API，不写入 Markdown 或日志。",
      "tvly-…",
      this.plugin.settings.searchApiKey,
      (value) => {
        this.plugin.settings.searchApiKey = value;
      },
      true
    );
    new Setting(containerEl)
      .setName("最大搜索结果数")
      .setDesc("每条 Query 最多返回的结果数，范围 1～10，默认 5。")
      .addText((text) => {
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.maxSearchResults))
          .onChange((value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
              this.plugin.settings.maxSearchResults = Math.min(10, Math.max(1, parsed));
              void this.plugin.saveSettings();
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "10";
      });

    new Setting(containerEl)
      .setName("隐私")
      .setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "LLM Provider 会收到当前文章的选定内容、召回的相关 Wiki / Raw 片段，以及分析或 Knowledge PR 所需上下文。Search Provider 只会收到冲突搜索 Query。默认不会发送整个 Vault、无关笔记、API Key、History 全量或未召回文件。"
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Claim Store 是完全本地、可删除重建的 Derived Index。Claim Comparison 只向 LLM 发送当前 Candidate Claim 和相关的 Top K Existing Claims，不会上传整个 Claim Store。"
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Freshness Risk 扫描完全在本地执行，不会联网。只有你主动点击验证某条知识时，Search Provider 才收到该 Claim 生成的 Query；LLM 只收到该 Claim 与筛选后的外部证据，不会收到整个 Claim Store。"
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `Claim Graph 是本地派生的 AI 关系建议层。只有你主动生成关系建议时，LLM 才会收到 Retrieval v2 筛选出的少量 Claim Pair。${CLAIM_GRAPH_RELEASE_NOTICE}${COMPRESSION_RELEASE_NOTICE}`
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "API Key 保存在当前 Vault 的插件 data.json 中，输入框默认隐藏；日志、History 与回归报告不会输出密钥。"
    });

    new Setting(containerEl)
      .setName("维护")
      .setHeading();
    this.renderClaimStoreMaintenance();
    this.renderClaimGraphMaintenance();
    const maintenanceStats = this.plugin.getMaintenanceStats();
    new Setting(containerEl)
      .setName("知识时效风险")
      .setDesc(
        `${maintenanceStats.status === "ready" ? "已扫描" : maintenanceStats.status === "corrupt" ? "数据损坏，可重新扫描" : "尚未扫描"}` +
        ` · Claims ${maintenanceStats.totalClaims} · Critical ${maintenanceStats.critical} · High ${maintenanceStats.high}`
      )
      .addButton((button) => button.setButtonText("扫描知识时效风险").setCta().onClick(() => {
        void this.plugin.scanFreshnessRisk()
          .then((result) => {
            new Notice(`本地扫描完成：${result.stats.totalClaims} Claims，耗时 ${result.durationMs.toFixed(1)} ms，未发起网络请求。`);
            this.display();
          })
          .catch((error: unknown) => {
            console.error("Knowledge Curator freshness scan failed.", error);
            new Notice("知识时效风险扫描失败。Claim Store 和 Wiki 未受影响。");
          });
      }));
    new Setting(containerEl)
      .setName("清除分析缓存")
      .setDesc("清除 SourceAnalysis 缓存，不会删除或修改任何 Markdown 文件。")
      .addButton((button) => button.setButtonText("清除…").onClick(() => {
        this.confirmMaintenance(
          "清除分析缓存",
          "确定清除所有分析缓存吗？不会删除任何 Markdown 文件。",
          async () => {
            await this.plugin.clearAnalysisCache();
            new Notice("分析缓存已清除。");
          }
        );
      }));
    new Setting(containerEl)
      .setName("清除 Claim Comparison 缓存")
      .setDesc("清除 Candidate 级派生比较结果；不会删除 Claim Store，也不会修改任何 Markdown。")
      .addButton((button) => button.setButtonText("清除…").onClick(() => {
        this.confirmMaintenance(
          "清除 Claim Comparison 缓存",
          "只会清除派生的 Claim Comparison 缓存，不会删除 Claim Store，也不会修改任何 Markdown。",
          async () => {
            const removed = await this.plugin.clearComparisonCache();
            new Notice(`已清除 ${removed} 条 Claim Comparison 缓存。`);
          }
        );
      }));
    new Setting(containerEl)
      .setName("清除冲突验证缓存")
      .setDesc("清除外部证据与验证结果缓存，不会删除或修改任何 Markdown 文件。")
      .addButton((button) => button.setButtonText("清除…").onClick(() => {
        this.confirmMaintenance(
          "清除冲突验证缓存",
          "确定清除所有冲突验证缓存吗？下次验证会重新调用搜索与模型服务。",
          async () => {
            await this.plugin.clearVerificationCache();
            new Notice("冲突验证缓存已清除。");
          }
        );
      }));
    new Setting(containerEl)
      .setName("清除知识时效验证缓存")
      .setDesc("清除 Freshness Verification 的搜索与验证复用缓存；风险扫描结果和 Markdown 不受影响。")
      .addButton((button) => button.setButtonText("清除…").onClick(() => {
        this.confirmMaintenance(
          "清除知识时效验证缓存",
          "确定清除知识时效验证缓存吗？不会删除风险扫描结果、Claim Store 或任何 Markdown。",
          async () => {
            const removed = await this.plugin.clearFreshnessVerificationCache();
            new Notice(`已清除 ${removed} 条知识时效验证缓存。`);
          }
        );
      }));
    new Setting(containerEl)
      .setName("清除 Draft PR 缓存")
      .setDesc("仅清除 draft / stale Knowledge PR；已接受或已拒绝记录和 Markdown 不受影响。")
      .addButton((button) => button.setButtonText("清除…").onClick(() => {
        this.confirmMaintenance(
          "清除 Draft PR 缓存",
          "确定清除所有待审核和已失效的 Knowledge PR 吗？不会修改 Wiki。",
          async () => {
            const removed = await this.plugin.clearDraftPRCache();
            new Notice(`已清除 ${removed} 条 Draft PR 缓存。`);
          }
        );
      }));
    new Setting(containerEl)
      .setName("History 审核记录")
      .setDesc("History 位于 .knowledge-agent/history/；本页不提供删除入口，避免误删审核记录。")
      .addButton((button) => button.setButtonText("查看数量").onClick(() => {
        void this.plugin.getHistoryCount()
          .then((count) => new Notice(`当前共有 ${count} 条 Knowledge PR History 记录。`))
          .catch((error: unknown) => {
            console.error("Knowledge Curator could not count History records.", error);
            new Notice("无法读取 History 记录数量。");
          });
      }));
  }

  private renderClaimStoreMaintenance(): void {
    const stats = this.plugin.getClaimStoreStats();
    const statusText = ({
      not_built: "尚未建立",
      building: "正在建立",
      ready: "就绪",
      partial: "部分可用",
      corrupt: "无法读取，需要重新构建"
    })[stats.status];
    const setting = new Setting(this.containerEl)
      .setName("Claim Store")
      .setDesc(
        `${statusText} · Claims ${stats.totalClaims} · Indexed Wiki ${stats.indexedWiki} · Failed ${stats.failedFiles}` +
        (stats.lastUpdated === undefined ? "" : ` · Last updated ${stats.lastUpdated}`)
      );
    if (stats.status === "building") {
      setting.addButton((button) => button
        .setButtonText("取消建立")
        .onClick(() => this.plugin.cancelClaimStoreBuild()));
      return;
    }
    setting.addButton((button) => button
      .setButtonText(stats.status === "not_built" ? "建立 Claim Store" : "重建 Claim Store")
      .setCta()
      .onClick(() => {
        this.confirmClaimStoreBuild(stats.status !== "not_built");
      }));
    if (stats.failedFiles > 0) {
      setting.addButton((button) => button
        .setButtonText("重试失败文件")
        .onClick(() => {
          void this.runClaimStoreBuild(false, true);
        }));
    }
  }

  private renderClaimGraphMaintenance(): void {
    const stats = this.plugin.getClaimGraphStats();
    const statusText = ({
      not_built: "尚未建立",
      building: "正在构建",
      ready: "就绪",
      stale: "需要重建",
      partial: "部分可用",
      corrupt: "无法读取，需要重新构建"
    })[stats.status];
    new Setting(this.containerEl)
      .setName("Claim Graph（AI 建议层）")
      .setDesc(
        `${statusText} · Claims ${stats.totalClaims} · Relations ${stats.totalRelations}` +
        ` · Conflicts ${stats.conflicts} · Duplicates ${stats.duplicates} · Orphans ${stats.orphanClaims}`
      )
      .addButton((button) => button
        .setButtonText(stats.status === "not_built" ? "生成关系建议" : "重新生成关系建议")
        .setCta()
        .setDisabled(stats.status === "building")
        .onClick(() => {
          new ConfirmActionModal(this.app, {
            title: stats.status === "not_built" ? "生成 Claim 关系建议" : "重新生成 Claim 关系建议",
            message: `将根据当前 Claim Store 检索候选 Claim Pair，并调用 LLM 提出关系建议。${CLAIM_GRAPH_RELEASE_NOTICE}结果只写入本地派生 Graph Store，不会修改任何 Markdown。`,
            confirmText: "确认构建",
            onConfirm: async () => {
              try {
                const result = await this.plugin.buildClaimGraph();
                new Notice(`Claim Graph 已完成：${result.stats.totalRelations} Relations，${result.stats.failedPairs} 失败 Pair。`);
              } catch (error: unknown) {
                console.error("Knowledge Curator Claim Graph build failed.", error);
                new Notice("Claim Graph 构建失败，Wiki 和 Claim Store 未受影响。");
              }
              this.display();
            }
          }).open();
        }));
  }

  private confirmClaimStoreBuild(rebuild: boolean): void {
    new ConfirmActionModal(this.app, {
      title: rebuild ? "重建 Claim Store" : "建立 Claim Store",
      message: rebuild
        ? "将根据当前 Wiki 重新生成 Claim 索引，不会修改任何 Markdown。"
        : "将读取当前配置的 Wiki 并建立本地 Claim 索引，不会修改任何 Markdown。",
      confirmText: rebuild ? "确认重建" : "确认建立",
      onConfirm: () => this.runClaimStoreBuild(rebuild, false)
    }).open();
  }

  private async runClaimStoreBuild(rebuild: boolean, retryFailedOnly: boolean): Promise<void> {
    try {
      const result = await this.plugin.buildClaimStore(rebuild, retryFailedOnly);
      new Notice(
        `Claim Store ${result.stats.status === "ready" ? "已建立" : "部分完成"}：` +
        `${result.stats.totalClaims} Claims，${result.stats.indexedWiki} Wiki，${result.stats.failedFiles} 失败。`
      );
      this.display();
    } catch (error: unknown) {
      console.error("Knowledge Curator Claim Store build failed.", error);
      new Notice("Claim Store 建立失败，已完成文件不会丢失，请重试。");
      this.display();
    }
  }

  private confirmMaintenance(
    title: string,
    message: string,
    action: () => Promise<void>
  ): void {
    new ConfirmActionModal(this.app, {
      title,
      message,
      confirmText: "确认清除",
      destructive: true,
      onConfirm: async () => {
        try {
          await action();
        } catch (error: unknown) {
          console.error(`Knowledge Curator ${title} failed.`, error);
          new Notice(`${title}失败，请查看 Console。`);
        }
      }
    }).open();
  }

  private addTextSetting(
    name: string,
    description: string,
    placeholder: string,
    currentValue: string,
    updateValue: (value: string) => void,
    isSecret = false
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(currentValue)
          .onChange((value) => {
            updateValue(value.trim());
            void this.plugin.saveSettings();
          });

        if (isSecret) {
          text.inputEl.type = "password";
        }
      });
  }

  private parseFolderList(value: string): string[] {
    const uniqueFolders = new Set<string>();
    for (const line of value.split(/\r?\n/u)) {
      const folder = line.trim();
      if (folder.length > 0) {
        uniqueFolders.add(folder);
      }
    }
    return Array.from(uniqueFolders);
  }
}
