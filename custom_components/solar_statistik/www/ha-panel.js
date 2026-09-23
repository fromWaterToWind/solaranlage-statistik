class SolarStatistikPanel extends HTMLElement {
  connectedCallback() {
    this.style.cssText = "display:block;width:100%;height:100%;";

    const host = this.parentElement;
    if (host) {
      host.style.display = "block";
      host.style.height = "100%";
      host.style.position = "relative";
    }

    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        iframe {
          display: block;
          border: 0;
          width: 100%;
          height: 100%;
          background: #0e100e;
        }
      </style>
      <iframe src="/solar-statistik/index.html" title="Solar Statistik"></iframe>
    `;
  }
}

customElements.define("solar-statistik-panel", SolarStatistikPanel);
