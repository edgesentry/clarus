import { describe, it, expect, beforeEach } from "vitest";
import { updateDocumarisLink } from "./documaris-link.js";

function scaffold() {
  document.body.innerHTML = `
    <h3 id="sc-title">MV Fortune Star
      <span class="mmsi" id="sc-mmsi"></span>
      <a id="sc-documaris-link" href="#" style="display:none"></a>
    </h3>
  `;
}

describe("updateDocumarisLink", () => {
  beforeEach(scaffold);

  it("sets href to documaris with ?mmsi= query param", () => {
    updateDocumarisLink("563012345");
    const link = document.getElementById("sc-documaris-link") as HTMLAnchorElement;
    expect(link.href).toBe("https://documaris.edgesentry.io/?mmsi=563012345");
  });

  it("makes the link visible", () => {
    updateDocumarisLink("563012345");
    const link = document.getElementById("sc-documaris-link") as HTMLAnchorElement;
    expect(link.style.display).toBe("inline");
  });

  it("updates href when called again with a different mmsi", () => {
    updateDocumarisLink("111111111");
    updateDocumarisLink("999999999");
    const link = document.getElementById("sc-documaris-link") as HTMLAnchorElement;
    expect(link.href).toBe("https://documaris.edgesentry.io/?mmsi=999999999");
  });

  it("does nothing if the element is absent", () => {
    document.body.innerHTML = "";
    expect(() => updateDocumarisLink("563012345")).not.toThrow();
  });
});
