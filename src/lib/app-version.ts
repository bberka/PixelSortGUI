// The version stamped at build time (vite.config.ts).
export function getAppVersionLabel(): string {
	const stamped = (globalThis as {VITE_APP_VERSION?: string}).VITE_APP_VERSION;
	return typeof stamped === 'string' && stamped.trim().length > 0
		? stamped.trim()
		: '0.x (dev)';
}
