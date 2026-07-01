export interface ServiceConnectionStatus {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  canSend?: boolean;
  canUse?: boolean;
}

export interface GoogleConnectionStatus {
  calendar: ServiceConnectionStatus;
  gmail: ServiceConnectionStatus;
  youtube: ServiceConnectionStatus;
}
