"""Solar Statistik — sidebar app for Home Assistant Companion."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH, STATIC_URL_PATH

WWW_DIR = Path(__file__).parent / "www"


async def async_setup(hass: HomeAssistant, _config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    if not hass.data[DOMAIN].get("static_registered"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    STATIC_URL_PATH,
                    str(WWW_DIR),
                    cache_headers=False,
                )
            ]
        )
        hass.data[DOMAIN]["static_registered"] = True

    try:
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name="solar-statistik-panel",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{STATIC_URL_PATH}/ha-panel.js",
            embed_iframe=True,
            require_admin=False,
        )
    except ValueError:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name="solar-statistik-panel",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{STATIC_URL_PATH}/ha-panel.js",
            embed_iframe=True,
            require_admin=False,
        )
    return True


async def async_unload_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True
