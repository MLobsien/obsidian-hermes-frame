import { ItemView, Plugin, WorkspaceLeaf, Setting, PluginSettingTab, App, requestUrl, Modal } from "obsidian";

const VIEW_TYPE_HERMES_FRAME = "hermes-frame-view";

// --- Cross-platform crypto via Web Crypto API ---

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

async function encryptPayload(plain: string, password: string): Promise<string> {
	if (!plain) return "";
	const enc = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(password, salt);
	const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
	// Pack salt + iv + ciphertext into one base64 string
	const buf = new Uint8Array(salt.length + iv.length + new Uint8Array(encrypted).length);
	buf.set(salt, 0);
	buf.set(iv, salt.length);
	buf.set(new Uint8Array(encrypted), salt.length + iv.length);
	return btoa(String.fromCharCode(...buf));
}

async function decryptPayload(encoded: string, password: string): Promise<string> {
	if (!encoded) return "";
	const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
	const salt = raw.slice(0, 16);
	const iv = raw.slice(16, 28);
	const ciphertext = raw.slice(28);
	const key = await deriveKey(password, salt);
	const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
	return new TextDecoder().decode(decrypted);
}

// --- Settings ---

interface HermesFrameSettings {
	statusUrl: string;
	fallbackUrl: string;
	hermesUrl: string;
	pollIntervalSeconds: number;
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

// --- Unlock Modal ---

class UnlockModal extends Modal {
	private password = "";
	private resolve: (pw: string) => void;

	constructor(app: App, resolve: (pw: string) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Unlock Hermes Frame" });
		contentEl.createEl("p", { text: "Enter your vault password to decrypt credentials." });

		const input = contentEl.createEl("input", {
			type: "password",
			attr: { placeholder: "Vault password" },
		});
		input.style.width = "100%";
		input.style.marginTop = "8px";

		const btn = contentEl.createEl("button", { text: "Unlock" });
		btn.style.marginTop = "12px";
		btn.onclick = () => {
			this.password = input.value;
			this.close();
			this.resolve(this.password);
		};

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.password = input.value;
				this.close();
				this.resolve(this.password);
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

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

	private updateIframe(): void {
		if (!this.iframe) return;

		const rawUrl = this.pcOnline ? this.settings.hermesUrl : this.settings.fallbackUrl;

		// If no credentials set, use raw URL
		if (!this.settings.hermesUsernameEnc) {
			if (this.iframe.src !== rawUrl) {
				this.iframe.src = rawUrl;
			}
			return;
		}

		// Decrypt and build auth URL — uses cached password from plugin
		this.plugin.getDecryptedUrl(rawUrl).then((url) => {
			if (this.iframe && this.iframe.src !== url) {
				this.iframe.src = url;
			}
		});
	}
}

// --- Plugin ---

export default class HermesFramePlugin extends Plugin {
	settings: HermesFrameSettings = DEFAULT_SETTINGS;
	private vaultPassword: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_HERMES_FRAME,
			(leaf) => new HermesFrameView(leaf, this.settings, this)
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

	// Prompt for vault password (once per session)
	private async ensurePassword(): Promise<string | null> {
		if (this.vaultPassword) return this.vaultPassword;

		return new Promise<string | null>((resolve) => {
			new UnlockModal(this.app, (pw) => {
				this.vaultPassword = pw;
				resolve(pw);
			}).open();
		});
	}

	// Encrypt and store credential
	async encryptCredential(field: "hermesUsernameEnc" | "hermesPasswordEnc", plain: string): Promise<void> {
		if (!plain) {
			this.settings[field] = "";
			return;
		}
		const pw = await this.ensurePassword();
		if (!pw) return;
		this.settings[field] = await encryptPayload(plain, pw);
	}

	// Decrypt credential
	async decryptCredential(field: "hermesUsernameEnc" | "hermesPasswordEnc"): Promise<string> {
		const encoded = this.settings[field];
		if (!encoded) return "";
		const pw = await this.ensurePassword();
		if (!pw) return "";
		try {
			return await decryptPayload(encoded, pw);
		} catch {
			// Wrong password or corrupted data
			return "";
		}
	}

	// Build auth URL for iframe
	async getDecryptedUrl(baseUrl: string): Promise<string> {
		const username = await this.decryptCredential("hermesUsernameEnc");
		const password = await this.decryptCredential("hermesPasswordEnc");

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

		// --- Credentials ---

		containerEl.createEl("h3", { text: "Hermes Login" });
		containerEl.createEl("p", {
			text: "Credentials are encrypted with a vault password using AES-256-GCM (Web Crypto API). Works on all platforms.",
			cls: "setting-item-description",
		});

		// Show current username (decrypted) if available
		this.plugin.decryptCredential("hermesUsernameEnc").then((currentUsername) => {
			new Setting(containerEl)
				.setName("Username")
				.setDesc("Hermes dashboard username")
				.addText((text) =>
					text
						.setPlaceholder("username")
						.setValue(currentUsername)
						.onChange(async (value) => {
							await this.plugin.encryptCredential("hermesUsernameEnc", value);
							await this.plugin.saveSettings();
						})
				);
		});

		this.plugin.decryptCredential("hermesPasswordEnc").then((currentPassword) => {
			new Setting(containerEl)
				.setName("Password")
				.setDesc("Hermes dashboard password")
				.addText((text) => {
					text
						.setPlaceholder("password")
						.setValue(currentPassword)
						.onChange(async (value) => {
							await this.plugin.encryptCredential("hermesPasswordEnc", value);
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				});
		});
	}
}
