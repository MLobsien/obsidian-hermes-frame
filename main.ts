import { ItemView, Plugin, WorkspaceLeaf, Setting, PluginSettingTab, App, requestUrl } from "obsidian";

const VIEW_TYPE_HERMES_FRAME = "hermes-frame-view";

// Electron safeStorage for OS keychain encryption
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const electron = (window as any).require?.("electron");
const safeStorage = electron?.safeStorage;

interface HermesFrameSettings {
	statusUrl: string;
	fallbackUrl: string;
	hermesUrl: string;
	pollIntervalSeconds: number;
	// Encrypted credentials (safeStorage encrypted buffers, stored as base64)
	hermesUsernameEnc: string;
	hermesPasswordEnc: string;
}

const DEFAULT_SETTINGS: HermesFrameSettings = {
	statusUrl: "http://server-von-mads:8080/action/status",
	fallbackUrl: "http://server-von-mads:8080",
	hermesUrl: "http://Desktop-von-Mads:9119",
	pollIntervalSeconds: 5,
	hermesUsernameEnc: "",
	hermesPasswordEnc: "",
};

// Helper: encrypt string → base64
function encryptString(plain: string): string {
	if (!safeStorage || !plain) return "";
	const buf = safeStorage.encryptString(plain);
	return Buffer.from(buf).toString("base64");
}

// Helper: base64 → decrypted string
function decryptString(encoded: string): string {
	if (!safeStorage || !encoded) return "";
	const buf = Buffer.from(encoded, "base64");
	return safeStorage.decryptString(buf);
}

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

	private buildAuthUrl(baseUrl: string): string {
		const username = decryptString(this.settings.hermesUsernameEnc);
		const password = decryptString(this.settings.hermesPasswordEnc);

		if (!username) return baseUrl;

		// Basic Auth via URL: http://user:pass@host:port/
		const url = new URL(baseUrl);
		url.username = username;
		url.password = password;
		return url.toString();
	}

	private updateIframe(): void {
		if (!this.iframe) return;

		const rawUrl = this.pcOnline ? this.settings.hermesUrl : this.settings.fallbackUrl;
		const url = this.buildAuthUrl(rawUrl);

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

	// Public API for settings tab
	encryptAndStore(field: "hermesUsernameEnc" | "hermesPasswordEnc", plain: string): void {
		this.settings[field] = encryptString(plain);
	}

	decryptField(field: "hermesUsernameEnc" | "hermesPasswordEnc"): string {
		return decryptString(this.settings[field]);
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

		// --- Credentials (encrypted via OS keychain) ---

		containerEl.createEl("h3", { text: "Hermes Login" });

		if (!safeStorage) {
			containerEl.createEl("p", {
				text: "⚠️ safeStorage not available — credentials cannot be encrypted on this platform.",
				cls: "setting-item-description",
			});
		}

		const currentUsername = this.plugin.decryptField("hermesUsernameEnc");

		new Setting(containerEl)
			.setName("Username")
			.setDesc("Hermes dashboard username (encrypted via OS keychain)")
			.addText((text) =>
				text
					.setPlaceholder("username")
					.setValue(currentUsername)
					.onChange(async (value) => {
						this.plugin.encryptAndStore("hermesUsernameEnc", value);
						await this.plugin.saveSettings();
					})
			);

		const currentPassword = this.plugin.decryptField("hermesPasswordEnc");

		new Setting(containerEl)
			.setName("Password")
			.setDesc("Hermes dashboard password (encrypted via OS keychain)")
			.addText((text) => {
				text
					.setPlaceholder("password")
					.setValue(currentPassword)
					.onChange(async (value) => {
						this.plugin.encryptAndStore("hermesPasswordEnc", value);
						await this.plugin.saveSettings();
					});
				// Mask the input field
				text.inputEl.type = "password";
			});
	}
}
