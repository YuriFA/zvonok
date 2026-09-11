import { ApiError, AuthError, NetworkError, ValidationError } from "@/lib/api/api.errors";

import type {
  DevApiKeyCreated,
  DevApiKeyView,
  DevProject,
  DevProjectRoom,
  DevRecordingView,
  DevWebhookConfigured,
} from "../types/console.types";

const TOKEN_STORAGE_KEY = "zvonok.dev-token";

/** Server list responses: a page plus the continuation cursor. */
type PageEnvelope<T> = { items: T[]; next: string | null };

/**
 * HTTP client for the developer surface. Unlike the app's cookie-based
 * ApiClient, developer endpoints authenticate with a short-lived bearer
 * token stored in sessionStorage - the console keeps it in headers only.
 */
class DevApi {
  getToken(): string | null {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  }

  setToken(token: string): void {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  clearToken(): void {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const url = `${API_BASE_URL}${endpoint}`;

    const config: RequestInit = {
      ...options,
      // The SSO endpoint authenticates through the app's cookie session;
      // every other endpoint ignores it.
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      if (!response.ok) {
        await this.handleError(response);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof ApiError || error instanceof AuthError) {
        throw error;
      }
      throw new NetworkError(error instanceof Error ? error.message : "Network error occurred");
    }
  }

  private async handleError(response: Response): Promise<never> {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      // Response body is empty or not JSON
    }
    const message = this.extractErrorMessage(details);

    switch (response.status) {
      case 400:
        throw new ValidationError(message, details);
      case 401:
        // The short-lived dev token expired: tell the console layout to
        // clear it and bounce to the login.
        window.dispatchEvent(new Event("zvonok:dev-auth-expired"));
        throw new AuthError(message, 401, details);
      default:
        throw new ApiError(message, response.status, details);
    }
  }

  private extractErrorMessage(details: unknown): string {
    if (typeof details === "string") {
      return details;
    }
    if (details && typeof details === "object" && "message" in details) {
      return String(details.message);
    }
    return "An error occurred";
  }

  // --- Auth ---

  async login(username: string, password: string): Promise<void> {
    const { token } = await this.request<{ token: string }>("/developers/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.setToken(token);
  }

  async register(username: string, password: string): Promise<void> {
    const { token } = await this.request<{ token: string }>("/developers/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.setToken(token);
  }

  /**
   * One-click console entry for a signed-in site user: the app cookie
   * session authenticates the SSO endpoint, which returns a dev token for
   * the user's linked developer account.
   */
  async ssoLogin(): Promise<{ username: string; created: boolean }> {
    const { token, username, created } = await this.request<{
      token: string;
      username: string;
      created: boolean;
    }>("/developers/auth/sso", { method: "POST" });
    this.setToken(token);
    return { username, created };
  }

  // --- Projects ---

  async listProjects(): Promise<DevProject[]> {
    const page = await this.request<PageEnvelope<DevProject>>("/developers/projects");
    return page.items;
  }

  async createProject(name: string): Promise<DevProject> {
    return this.request<DevProject>("/developers/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  // --- API keys ---

  async listApiKeys(projectId: string): Promise<DevApiKeyView[]> {
    return this.request<DevApiKeyView[]>(`/developers/projects/${projectId}/keys`);
  }

  async createApiKey(projectId: string): Promise<DevApiKeyCreated> {
    return this.request<DevApiKeyCreated>(`/developers/projects/${projectId}/keys`, {
      method: "POST",
    });
  }

  async revokeApiKey(keyId: string): Promise<void> {
    return this.request<void>(`/developers/keys/${keyId}`, {
      method: "DELETE",
    });
  }

  // --- Webhooks ---

  async setWebhook(projectId: string, url: string): Promise<DevWebhookConfigured> {
    return this.request<DevWebhookConfigured>(`/developers/projects/${projectId}/webhooks`, {
      method: "PUT",
      body: JSON.stringify({ url }),
    });
  }

  async removeWebhook(projectId: string): Promise<void> {
    return this.request<void>(`/developers/projects/${projectId}/webhooks`, {
      method: "DELETE",
    });
  }

  // --- Rooms and recordings ---

  async listRooms(projectId: string): Promise<DevProjectRoom[]> {
    const page = await this.request<PageEnvelope<DevProjectRoom>>(
      `/developers/projects/${projectId}/rooms`,
    );
    return page.items;
  }

  async listRecordings(projectId: string): Promise<DevRecordingView[]> {
    const page = await this.request<PageEnvelope<DevRecordingView>>(
      `/developers/projects/${projectId}/recordings`,
    );
    return page.items;
  }

  /**
   * Fetch one recording's bytes as a blob for in-browser playback. The dev
   * token stays in the Authorization header - never in a media element URL.
   */
  async fetchRecordingFile(projectId: string, egressId: string): Promise<Blob> {
    const token = this.getToken();
    const response = await fetch(
      `${API_BASE_URL}/developers/projects/${projectId}/recordings/${egressId}/file`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!response.ok) {
      await this.handleError(response);
    }
    return response.blob();
  }
}

const API_BASE_URL =
  (import.meta.env as { VITE_API_BASE_URL?: string }).VITE_API_BASE_URL ?? "http://localhost:3000";

// Singleton instance
export const devApi = new DevApi();
