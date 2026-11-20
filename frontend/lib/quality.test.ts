import { describe, expect, it } from "vitest";

import { MAX_DPR, pickQuality, QUALITY_SETTINGS, type QualityInputs } from "./quality";

const desktop: QualityInputs = {
  coarsePointer: false,
  viewportWidth: 1440,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
};
const phone: QualityInputs = {
  coarsePointer: true,
  viewportWidth: 375,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  renderer: null,
};

describe("pickQuality", () => {
  it("is high on a desktop with a real GPU", () => {
    expect(pickQuality(desktop)).toBe("high");
  });

  it("is high on a desktop that reports nothing about itself", () => {
    expect(pickQuality({ coarsePointer: false, viewportWidth: 1440 })).toBe("high");
    expect(
      pickQuality({ ...desktop, hardwareConcurrency: null, deviceMemory: null, renderer: null }),
    ).toBe("high");
  });

  it.each([
    "Mali-G78 MP14",
    "ANGLE (ARM, Mali-G610 MC6, OpenGL ES 3.2)",
    "Immortalis-G715",
    "Adreno (TM) 650",
    "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)",
    "PowerVR Rogue GE8320",
    "ANGLE (Samsung Xclipse 920) on Vulkan 1.1.179",
    "VideoCore VI",
  ])("is low on the mobile GPU %s, whatever the rest says", (renderer) => {
    expect(pickQuality({ ...desktop, renderer })).toBe("low");
  });

  it.each([
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    "llvmpipe (LLVM 17.0.6, 256 bits)",
    "softpipe",
    "Microsoft Basic Render Driver",
  ])("is low on the software renderer %s", (renderer) => {
    expect(pickQuality({ ...desktop, renderer })).toBe("low");
  });

  it("is low on an Apple GPU behind a touch screen, at any width", () => {
    expect(pickQuality({ ...desktop, coarsePointer: true, viewportWidth: 390, renderer: "Apple GPU" })).toBe("low");
    expect(pickQuality({ ...desktop, coarsePointer: true, viewportWidth: 1180, renderer: "Apple GPU" })).toBe("low");
  });

  it("is high on an Apple GPU with a mouse or trackpad", () => {
    expect(pickQuality({ ...desktop, renderer: "Apple GPU" })).toBe("high");
    expect(
      pickQuality({ ...desktop, renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" }),
    ).toBe("high");
  });

  it("is low on a phone that hides its GPU", () => {
    expect(pickQuality(phone)).toBe("low");
    expect(pickQuality({ ...phone, viewportWidth: 767 })).toBe("low");
  });

  it("does not call a wide touch screen with a desktop GPU a phone", () => {
    expect(pickQuality({ ...desktop, coarsePointer: true, viewportWidth: 1280 })).toBe("high");
    expect(pickQuality({ ...desktop, coarsePointer: true, viewportWidth: 768 })).toBe("high");
  });

  it("does not call a narrow desktop window a phone", () => {
    expect(pickQuality({ ...desktop, viewportWidth: 375 })).toBe("high");
  });

  it("is low with few cores or little memory", () => {
    expect(pickQuality({ ...desktop, hardwareConcurrency: 4 })).toBe("low");
    expect(pickQuality({ ...desktop, hardwareConcurrency: 2 })).toBe("low");
    expect(pickQuality({ ...desktop, deviceMemory: 4 })).toBe("low");
    expect(pickQuality({ ...desktop, deviceMemory: 2 })).toBe("low");
    expect(pickQuality({ ...desktop, hardwareConcurrency: 6, deviceMemory: 8 })).toBe("high");
  });

  it("ignores values a browser reports as zero", () => {
    expect(pickQuality({ ...desktop, hardwareConcurrency: 0, deviceMemory: 0 })).toBe("high");
  });
});

describe("quality settings", () => {
  it("cap the device pixel ratio at 1.5 at every level", () => {
    expect(MAX_DPR).toBe(1.5);
    expect(QUALITY_SETTINGS.high.maxDpr).toBe(1.5);
    expect(QUALITY_SETTINGS.low.maxDpr).toBe(1.5);
  });

  it("turn shadow maps and image-based lighting off at the low level only", () => {
    expect(QUALITY_SETTINGS.low).toMatchObject({ shadows: false, environment: false });
    expect(QUALITY_SETTINGS.high).toMatchObject({ shadows: true, environment: true });
  });
});
