// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { avatarEl } from "./avatar";

describe("avatarEl", () => {
  it("shows the preset's photo as an image in a round wrapper over the preset's hue", () => {
    const el = avatarEl({ id: "perlica", name: "Perlica", thumbnail: "asset://p.png" }, 20);
    const img = el.querySelector("img")!;

    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("yui-uc__avatar");
    expect(el.style.background).toBe(avatarEl({ id: "perlica", name: "P" }, 20).style.background);
    expect(el.children).toHaveLength(1);
    expect(img.getAttribute("src")).toBe("asset://p.png");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("draws the stored crop on the image and nothing for an uncropped one", () => {
    const crop = { x: 0.2, y: 0.05, size: 0.5 };
    const cropped = avatarEl({ id: "p", name: "P", thumbnail: "asset://p.png", crop }, 20)
      .firstElementChild as HTMLElement;
    const plain = avatarEl({ id: "p", name: "P", thumbnail: "asset://p.png" }, 20)
      .firstElementChild as HTMLElement;

    expect(cropped.classList.contains("is-cropped")).toBe(true);
    expect(
      ["--yui-crop-x", "--yui-crop-y", "--yui-crop-size"].map((k) =>
        cropped.style.getPropertyValue(k),
      ),
    ).toEqual(["0.2", "0.05", "0.5"]);
    expect(plain.classList.contains("is-cropped")).toBe(false);
    expect(plain.style.getPropertyValue("--yui-crop-size")).toBe("");
  });

  it("falls back to a dot in a hue that depends only on the id", () => {
    const el = avatarEl({ id: "perlica", name: "Perlica" }, 20);

    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("yui-uc__dot");
    expect(el.style.background).not.toBe("");
    expect(avatarEl({ id: "natsume", name: "Natsume" }, 12).style.background).not.toBe(
      el.style.background,
    );
    expect(avatarEl({ id: "perlica", name: "Other" }, 12).style.background).toBe(
      el.style.background,
    );
  });
});
