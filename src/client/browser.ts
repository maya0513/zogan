/**
 * ブラウザ API への出口を 1 箇所に集める。
 *
 * フォールバック（location.assign）はテストから差し替えられる必要があるため、
 * 直接呼ばずここを経由する。zogan/client はサーババンドルでも評価可能でなければ
 * ならないので、参照はすべて関数の内側に閉じる（§7.3.2）。
 */
export const browser = {
  /** フォールバック = 元のクリックと同じ遷移をブラウザに行わせる（§7.3.1） */
  hardNavigate(url: string): void {
    location.assign(url);
  },
  reload(): void {
    location.reload();
  },
};
