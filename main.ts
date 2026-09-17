import { ItemView, Plugin, WorkspaceLeaf, Setting, PluginSettingTab, App, requestUrl, addIcon } from "obsidian";

const VIEW_TYPE_HERMES_FRAME = "hermes-frame-view";

// --- Settings ---

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

// --- View ---

class HermesFrameView extends ItemView {
	private iframe: HTMLIFrameElement | null = null;
	private statusIndicator: HTMLElement | null = null;
	private pollInterval: number | null = null;
	private pcOnline = false;
	private settings: HermesFrameSettings;
	private plugin: HermesFramePlugin;

	constructor(leaf: WorkspaceLeaf, settings: HermesFrameSettings, plugin: HermesFramePlugin) {
		super(leaf);
		this.settings = settings;
		this.plugin = plugin;
		this.navigation = false;
	}

	getViewType(): string {
		return VIEW_TYPE_HERMES_FRAME;
	}

	getDisplayText(): string {
		return "Hermes Frame";
	}

	getIcon(): string {
		return "hermes-frame";
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
			const response = await requestUrl({
				url: this.settings.statusUrl,
				method: "GET",
			});

			const wasOnline = this.pcOnline;
			this.pcOnline = response.status >= 200 && response.status < 300;

			this.updateStatusIndicator();

			if (wasOnline !== this.pcOnline) {
				await this.updateIframe();
			}
		} catch {
			const wasOnline = this.pcOnline;
			this.pcOnline = false;

			this.updateStatusIndicator();

			if (wasOnline) {
				await this.updateIframe();
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

	private async updateIframe(): Promise<void> {
		if (!this.iframe) return;

		const rawUrl = this.pcOnline ? this.settings.hermesUrl : this.settings.fallbackUrl;
		const url = await this.plugin.getAuthUrl(rawUrl);

		if (this.iframe.src !== url) {
			this.iframe.src = url;
		}
	}
}

// --- Plugin ---

export default class HermesFramePlugin extends Plugin {
	settings: HermesFrameSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		addIcon("hermes-frame", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M50 55 Q30 45 15 25 Q25 40 35 50 Q25 45 10 30 Q22 48 38 55 L50 55"/><path d="M50 55 Q70 45 85 25 Q75 40 65 50 Q75 45 90 30 Q78 48 62 55 L50 55"/></svg>`);

		this.registerView(
			VIEW_TYPE_HERMES_FRAME,
			(leaf) => new HermesFrameView(leaf, this.settings, this)
		);

		this.addRibbonIcon("hermes-frame", "Toggle Hermes Frame", () => {
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

	// --- SecretStorage (OS Keychain) ---

	private getSecretStorage(): any | null {
		return (this.app as any).secretStorage ?? null;
	}

	async getAuthUrl(baseUrl: string): Promise<string> {
		const secretStorage = this.getSecretStorage();
		if (!secretStorage) return baseUrl;

		const username = secretStorage.getSecret("hermes-frame-username") ?? "";
		const password = secretStorage.getSecret("hermes-frame-password") ?? "";

		if (!username) return baseUrl;

		const url = new URL(baseUrl);
		url.username = username;
		url.password = password;
		return url.toString();
	}
}

// --- Settings Tab ---

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


		new Setting(containerEl)
			.setName("Username")
			.setDesc("Hermes dashboard username")
			.addText((text) =>
				text
					.setPlaceholder("username")
					.setValue("")
					.onChange(async (value) => {
						const ss = (this.app as any).secretStorage;
						if (ss) ss.setSecret("hermes-frame-username", value);
					})
			);

		new Setting(containerEl)
			.setName("Password")
			.setDesc("Hermes dashboard password")
			.addText((text) => {
				text
					.setPlaceholder("password")
					.setValue("")
					.onChange(async (value) => {
						const ss = (this.app as any).secretStorage;
						if (ss) ss.setSecret("hermes-frame-password", value);
					});
				text.inputEl.type = "password";
			});
	}
}
