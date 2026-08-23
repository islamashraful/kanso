/**
 * A minimal outbound email boundary.
 *
 * Interface first, so the notifications worker depends on this rather than
 * on a provider SDK. There is no real provider yet — that arrives with
 * Week 4's deployment — so `createConsoleEmailSender` is what fills it
 * until then, and a test can substitute a fake that records calls instead
 * of asserting on console output.
 */
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

export const createConsoleEmailSender = (): EmailSender => ({
  send(to, subject, body) {
    console.log(`[email] to=${to} subject="${subject}"\n${body}`);
    return Promise.resolve();
  },
});
