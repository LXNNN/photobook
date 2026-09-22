declare module 'page-flip' {
  export interface PageFlipConfig {
    width?: number;
    height?: number;
    size?: 'fixed' | 'stretch';
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    [key: string]: any;
  }

  export interface PageData {
    src?: string;
    html?: string;
    [key: string]: any;
  }

  export class PageFlip {
    constructor(container: HTMLElement, config: PageFlipConfig);
    loadFromImages(images: PageData[]): void;
    loadFromHTML(items: HTMLElement[]): void;
    turnToPage(pageNum: number): void;
    turnToNextPage(): void;
    turnToPrevPage(): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    // 只用来读"这趟翻页往哪边翻"。
    // FlipDirection 是 page-flip 的 const enum，运行时拿不到名字，值就两个：
    // FORWARD = 0、BACK = 1。calc 在没在翻的时候是 null，所以这里的返回值可为空。
    getFlipController(): { getCalculation(): { getDirection(): number } | null };
    destroy(): void;
    on(event: string, callback: (e: { data: number | string | boolean | object; object: PageFlip }) => void): void;
    update(): void;
  }
}
