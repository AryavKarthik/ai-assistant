function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function getVapidPublicKey(): string {
  return requireEnv("VAPID_PUBLIC_KEY");
}

export function getVapidPrivateKey(): string {
  return requireEnv("VAPID_PRIVATE_KEY");
}

export function getVapidSubject(): string {
  return requireEnv("VAPID_SUBJECT");
}

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}
