type Env = Record<string, string | undefined>;
export function missingAuthKeys(env: Env): string[];
export function authRequired(env: Env): boolean;
export function assertAuthConfigured(env: Env): void;
