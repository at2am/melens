import type { Browser } from '@e2e-dev/web';

/** Let Flutter hand focus to its editing host before sending real key events. */
export async function settleFlutterFocus(browser: Browser): Promise<void> {
  await browser.evaluate(() => {
    const field = document.activeElement;
    const editable = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
      || field instanceof HTMLElement && field.isContentEditable;
    if (!editable) throw new Error('The tap must focus the intended editable field.');
    return new Promise<null>((fulfill, reject) => {
      let firstFrame = 0;
      let secondFrame = 0;
      const timer = setTimeout(() => {
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
        reject(new Error('Flutter focus settling exceeded two seconds.'));
      }, 2_000);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          clearTimeout(timer);
          if (!field.isConnected || document.activeElement !== field) {
            reject(new Error('The same field must retain editing focus.'));
            return;
          }
          fulfill(null);
        });
      });
    });
  });
}
