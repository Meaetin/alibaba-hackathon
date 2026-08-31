import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastThumbnailImage } from "./Toast";

describe("ToastThumbnailImage", () => {
  it("renders a runtime TikTok CDN thumbnail without Next image host validation", () => {
    const src =
      "https://p16-common-sign.tiktokcdn.com/tos-alisg-i-photomode-sg/photo.jpeg?x-signature=signed";

    const markup = renderToStaticMarkup(<ToastThumbnailImage src={src} />);

    expect(markup).toContain("p16-common-sign.tiktokcdn.com");
    expect(markup).not.toContain("/_next/image");
  });
});
