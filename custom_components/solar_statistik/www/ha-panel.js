class SolarStatistikPanel extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.style.width = "100%";
    this.style.height = "100%";
    const iframe = document.createElement("iframe");
    iframe.src = "/solar-statistik/index.html";
    iframe.setAttribute("title", "Solar Statistik");
    iframe.style.cssText =
      "border:0;width:100%;height:100%;display:block;background:#0e100e";
    this.appendChild(iframe);
  }
}

customElements.define("solar-statistik-panel", SolarStatistikPanel);
