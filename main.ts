import { ItemView, Plugin, WorkspaceLeaf, Setting, PluginSettingTab, App } from "obsidian";

const VIEW_TYPE_HERMES_FRAME = "hermes-frame-view";

interface HermesFrameSettings {
	statusUrl: string;
	fallbackUrl: string;
	hermesUrl: string;
	pollIntervalSeconds: number;
}

const DEFAULT_SETTINGS: HermesFrameSettings = {
	statusUrl: "http://server-von-mads:8080/action/status",
	fallbackUrl: "http://server-von-mads:8080",
	hermesUrl: "http://Desktop-von-Mads:9119",
	pollIntervalSeconds: 5,
};

class HermesFrameView extends ItemView {
	private iframe: HTMLIFrameElement | null = null;
	private statusIndicator: HTMLElement | null = null;
	private pollInterval: number | null = null;
	private pcOnline = false;
	private settings: HermesFrameSettings;

	constructor(leaf: WorkspaceLeaf, settings: HermesFrameSettings) {
		super(leaf);
		this.settings = settings;
		this.navigation = false;
	}

	getViewType(): string {
		return VIEW_TYPE_HERMES_FRAME;
	}

	getDisplayText(): string {
		return "Hermes Frame";
	}

	getIcon(): string {
		return "sidebox";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("hermes-frame-container");

		const statusBar = container.createDiv({ cls: "hermes-frame-status" });
		this.statusIndicator = statusBar.createDiv({ cls: "hermes-frame-indicator" });
		const statusText = statusBar.createSpan({ cls: "hermes-frame-status-text" });
		statusText.setText("Checking PC status…");

		this.iframe = container.createEl("iframe", {
			cls: "hermes-frame-iframe",
			attr: {
				sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
			},
		});

		await this.checkStatus();
		this.startPolling();
	}

	async onClose(): Promise<void> {
		this.stopPolling();
		this.contentEl.empty();
	}

	private startPolling(): void {
		this.stopPolling();
		this.pollInterval = window.setInterval(
			() => this.checkStatus(),
			this.settings.pollIntervalSeconds * 1000
		);
		this.registerInterval(this.pollInterval);
	}

	private stopPolling(): void {
		if (this.pollInterval !== null) {
			window.clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

	private async checkStatus(): Promise<void> {
		try {
			const controller = new AbortController();
			const timeoutId = window.setTimeout(() => controller.abort(), 3000);

			const response = await fetch(this.settings.statusUrl, {
				method: "GET",
				signal: controller.signal,
			});
			window.clearTimeout(timeoutId);

			const wasOnline = this.pcOnline;
			this.pcOnline = response.ok;

			this.updateStatusIndicator();

			if (wasOnline !== this.pcOnline) {
				this.updateIframe();
			}
		} catch {
			const wasOnline = this.pcOnline;
			this.pcOnline = false;

			this.updateStatusIndicator();

			if (wasOnline) {
				this.updateIframe();
			}
		}
	}

	private updateStatusIndicator(): void {
		if (!this.statusIndicator) return;

		const statusText = this.contentEl.querySelector(
			".hermes-frame-status-text"
		) as HTMLSpanElement | null;

		if (this.pcOnline) {
			this.statusIndicator.removeClass("offline");
			this.statusIndicator.addClass("online");
			if (statusText) statusText.setText("PC online — Hermes Agent");
		} else {
			this.statusIndicator.removeClass("online");
			this.statusIndicator.addClass("offline");
			if (statusText) statusText.setText("PC offline — Fallback page");
		}
	}

	private updateIframe(): void {
		if (!this.iframe) return;

		const url = this.pcOnline ? this.settings.hermesUrl : this.settings.fallbackUrl;

		if (this.iframe.src !== url) {
			this.iframe.src = url;
		}
	}
}

export default class HermesFramePlugin extends Plugin {
	settings: HermesFrameSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_HERMES_FRAME,
			(leaf) => new HermesFrameView(leaf, this.settings)
		);

		this.addRibbonIcon("sidebox", "Toggle Hermes Frame", () => {
			this.activateView();
		});

		this.addCommand({
			id: "toggle-hermes-frame",
			name: "Toggle Hermes Frame sidebar",
			callback: () => {
				this.activateView();
			},
		});

		this.addSettingTab(new HermesFrameSettingTab(this.app, this));
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_HERMES_FRAME);
	}

	async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_FRAME);
		if (existing.length > 0) {
			existing[0].detach();
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_HERMES_FRAME,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class HermesFrameSettingTab extends PluginSettingTab {
	plugin: HermesFramePlugin;

	constructor(app: App, plugin: HermesFramePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Hermes Frame Settings" });

		new Setting(containerEl)
			.setName("Status URL")
			.setDesc("URL to poll for PC status (GET request, 200 = online)")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.statusUrl)
					.setValue(this.plugin.settings.statusUrl)
					.onChange(async (value) => {
						this.plugin.settings.statusUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Fallback URL")
			.setDesc("URL to show when PC is offline")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.fallbackUrl)
					.setValue(this.plugin.settings.fallbackUrl)
					.onChange(async (value) => {
						this.plugin.settings.fallbackUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Hermes URL")
			.setDesc("URL to show when PC is online (Hermes Agent dashboard)")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.hermesUrl)
					.setValue(this.plugin.settings.hermesUrl)
					.onChange(async (value) => {
						this.plugin.settings.hermesUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Poll interval (seconds)")
			.setDesc("How often to check PC status")
			.addSlider((slider) =>
				slider
					.setLimits(2, 30, 1)
					.setValue(this.plugin.settings.pollIntervalSeconds)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.pollIntervalSeconds = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
