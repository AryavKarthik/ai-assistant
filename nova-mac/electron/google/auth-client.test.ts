import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGoogleTokenRow: vi.fn(),
  updateStoredRefreshToken: vi.fn(),
  decryptToken: vi.fn((payload: string) => payload.replace("enc:", "")),
  createOAuth2Client: vi.fn(),
}));

vi.mock("./db-tokens", () => ({
  getGoogleTokenRow: mocks.getGoogleTokenRow,
  isGoogleServiceConnected: (
    row: { calendar_connected?: boolean } | null,
    _service: string,
  ) => Boolean(row?.calendar_connected),
  updateStoredRefreshToken: mocks.updateStoredRefreshToken,
}));
vi.mock("./crypto", () => ({ decryptToken: mocks.decryptToken }));
vi.mock("./oauth", () => ({ createOAuth2Client: mocks.createOAuth2Client }));

import { getAuthenticatedOAuth2, resetAuthClientCache } from "./auth-client";
import { GOOGLE_AUTH_EXPIRED } from "./errors";

interface FakeOAuth2 {
  credentials: {
    refresh_token?: string;
    access_token?: string;
    expiry_date?: number;
  };
  setCredentials: (c: Record<string, unknown>) => void;
  on: (event: string, cb: (tokens: Record<string, string>) => void) => void;
  getAccessToken: ReturnType<typeof vi.fn>;
  emitTokens: (tokens: Record<string, string>) => void;
}

function makeFakeClient(
  behavior: () => Promise<void> = async () => {},
): FakeOAuth2 {
  let tokensCb: ((tokens: Record<string, string>) => void) | null = null;
  const client: FakeOAuth2 = {
    credentials: {},
    setCredentials(c) {
      Object.assign(client.credentials, c);
    },
    on(event, cb) {
      if (event === "tokens") tokensCb = cb;
    },
    getAccessToken: vi.fn(async () => {
      await behavior();
      client.credentials.access_token = "at";
      client.credentials.expiry_date = Date.now() + 3600_000;
      return { token: "at" };
    }),
    emitTokens(tokens) {
      tokensCb?.(tokens);
    },
  };
  return client;
}

function row(refresh: string) {
  return { encrypted_refresh: `enc:${refresh}`, calendar_connected: true };
}

beforeEach(() => {
  resetAuthClientCache();
  vi.clearAllMocks();
  mocks.decryptToken.mockImplementation((payload: string) =>
    payload.replace("enc:", ""),
  );
});

describe("getAuthenticatedOAuth2", () => {
  it("returns null when not connected", async () => {
    mocks.getGoogleTokenRow.mockResolvedValue(null);
    expect(await getAuthenticatedOAuth2("u1", "calendar")).toBeNull();
  });

  it("refreshes once and reuses the cached client while the access token is valid", async () => {
    mocks.getGoogleTokenRow.mockResolvedValue(row("r1"));
    const client = makeFakeClient();
    mocks.createOAuth2Client.mockReturnValue(client);

    const first = await getAuthenticatedOAuth2("u1", "calendar");
    const second = await getAuthenticatedOAuth2("u1", "calendar");

    expect(first).toBe(client);
    expect(second).toBe(client);
    expect(client.getAccessToken).toHaveBeenCalledTimes(1);
    expect(mocks.createOAuth2Client).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent callers into one refresh", async () => {
    mocks.getGoogleTokenRow.mockResolvedValue(row("r1"));
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const client = makeFakeClient(() => gate);
    mocks.createOAuth2Client.mockReturnValue(client);

    const a = getAuthenticatedOAuth2("u1", "calendar");
    const b = getAuthenticatedOAuth2("u1", "calendar");
    release();
    expect(await a).toBe(client);
    expect(await b).toBe(client);
    expect(client.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("re-reads the row and retries once on invalid_grant when the token was rotated elsewhere", async () => {
    mocks.getGoogleTokenRow
      .mockResolvedValueOnce(row("stale"))
      .mockResolvedValue(row("fresh"));
    const staleClient = makeFakeClient(async () => {
      throw new Error("invalid_grant");
    });
    const freshClient = makeFakeClient();
    mocks.createOAuth2Client
      .mockReturnValueOnce(staleClient)
      .mockReturnValueOnce(freshClient);

    const result = await getAuthenticatedOAuth2("u1", "calendar");
    expect(result).toBe(freshClient);
    expect(freshClient.credentials.refresh_token).toBe("fresh");
  });

  it("fails with an actionable message when the grant is truly dead", async () => {
    mocks.getGoogleTokenRow.mockResolvedValue(row("dead"));
    const client = makeFakeClient(async () => {
      throw new Error("invalid_grant");
    });
    mocks.createOAuth2Client.mockReturnValue(client);

    await expect(getAuthenticatedOAuth2("u1", "calendar")).rejects.toThrow(
      GOOGLE_AUTH_EXPIRED,
    );
  });

  it("keeps the cache valid across a Google-side refresh token rotation", async () => {
    mocks.getGoogleTokenRow.mockResolvedValue(row("r1"));
    const client = makeFakeClient();
    mocks.createOAuth2Client.mockReturnValue(client);

    await getAuthenticatedOAuth2("u1", "calendar");
    client.emitTokens({ refresh_token: "r2" });
    expect(mocks.updateStoredRefreshToken).toHaveBeenCalledWith("u1", "r2");

    // Next call reads the rotated token from the row; cache must still hit.
    mocks.getGoogleTokenRow.mockResolvedValue(row("r2"));
    const again = await getAuthenticatedOAuth2("u1", "calendar");
    expect(again).toBe(client);
    expect(client.getAccessToken).toHaveBeenCalledTimes(1);
  });
});
