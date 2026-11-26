import type {PersistenceOutcome} from '@/storage/quota.ts';

export type BrowserFamily = 'chromium' | 'firefox' | 'safari' | 'other';

export type ProtectionResult = PersistenceOutcome | 'pending';

/**
 Chooses which advice to show, never what the app does. Every iOS browser is
 WebKit, so it gets the Safari advice whatever it calls itself.
 */
export function browserFamily(userAgent: string): BrowserFamily {
	if (/iPhone|iPad|iPod/.test(userAgent)) {
		return 'safari';
	}

	if (userAgent.includes('Firefox/')) {
		return 'firefox';
	}

	if (/Chrom(?:e|ium)\//.test(userAgent)) {
		return 'chromium';
	}

	return userAgent.includes('Safari/') ? 'safari' : 'other';
}

const DENIED_MESSAGES: Record<BrowserFamily, string> = {
	chromium:
		'Not granted. This browser decides without asking. Bookmark Drift or install it as an app, keep using it, then try again.',
	firefox:
		'Not granted. Request again and choose Allow in the prompt. If no prompt appears, clear the blocked permission from the icon beside the address.',
	safari:
		'Not granted. This browser decides without asking. Add Drift to your Home Screen or Dock, open it from there, then try again.',
	other:
		'Not granted. Bookmark or install Drift if your browser allows it, keep using it, then try again.',
};

export function protectionMessage(
	result: ProtectionResult,
	family: BrowserFamily,
): string {
	switch (result) {
		case 'granted': {
			return "Storage protection granted. The browser will not clear Drift's data to free disk space.";
		}

		case 'denied': {
			return DENIED_MESSAGES[family];
		}

		case 'unsupported': {
			return 'Storage protection is not available here. Open Drift over HTTPS in a current browser.';
		}

		case 'failed': {
			return 'The protection request failed. Reload Drift and try again.';
		}

		case 'pending': {
			return family === 'firefox'
				? 'Waiting for your answer. Choose Allow in the browser prompt. If you closed it, reopen it from the icon beside the address.'
				: 'The browser has not answered yet. You can keep working; this updates when it answers.';
		}
	}
}
