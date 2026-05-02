/**
 * Test stub for `expo-server-sdk`. The real package is ESM-only and trips up
 * Jest's CommonJS transformer; tests don't need to actually contact Expo's
 * push service, so we map imports to this stub via `jest.moduleNameMapper`.
 *
 * Production code paths through this module are covered by integration tests
 * in `test/*.e2e-spec.ts` (which run with the real SDK via ts-jest's e2e
 * config), not the unit suites here.
 */

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: string;
  priority?: 'default' | 'normal' | 'high';
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export class Expo {
  static isExpoPushToken(token: string): boolean {
    return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
  }
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
    return messages.length === 0 ? [] : [messages];
  }
  async sendPushNotificationsAsync(_messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    return _messages.map(() => ({ status: 'ok' as const }));
  }
}
