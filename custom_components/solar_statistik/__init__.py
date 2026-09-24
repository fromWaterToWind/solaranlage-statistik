"""Solar Statistik — sidebar app for Home Assistant Companion."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType
from aiohttp import web

from .const import DOMAIN, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH, STATIC_URL_PATH

WWW_DIR = Path(__file__).parent / "www"
GROWATT_BASE = "https://openapi.growatt.com"


class GrowattProxyView(HomeAssistantView):
    """Forward Growatt Open API calls so the panel can read history beyond recorder."""

    url = "/api/solar_statistik/growatt/{path:.*}"
    name = "api:solar_statistik:growatt"
    requires_auth = True

    async def get(self, request: web.Request, path: str) -> web.StreamResponse:
        return await self._forward(request, path, "get")

    async def post(self, request: web.Request, path: str) -> web.StreamResponse:
        return await self._forward(request, path, "post")

    async def _forward(self, request: web.Request, path: str, method: str) -> web.StreamResponse:
        token = (
            request.headers.get("token")
            or request.headers.get("Token")
            or request.headers.get("X-Growatt-Token")
        )
        if not token:
            return web.json_response({"error": "missing Growatt token"}, status=400)
        session = async_get_clientsession(request.app["hass"])
        url = f"{GROWATT_BASE}/{path.lstrip('/')}"
        if request.query_string:
            url = f"{url}?{request.query_string}"
        http = getattr(session, method)
        kwargs: dict = {
            "headers": {
                "token": token,
                "Accept": "application/json",
                "User-Agent": request.headers.get("User-Agent", "Mozilla/5.0"),
            },
            "allow_redirects": False,
        }
        if method == "post":
            kwargs["data"] = await request.read()
            content_type = request.headers.get("Content-Type")
            if content_type:
                kwargs["headers"]["Content-Type"] = content_type
        async with http(url, **kwargs) as resp:
            if 300 <= resp.status < 400:
                loc = resp.headers.get("Location", "")
                return web.json_response(
                    {
                        "error_code": -1,
                        "error_msg": f"HTTP {resp.status} Umleitung nach {loc or '(ohne Location)'} — kein v4-JSON",
                    },
                    status=502,
                )
            body = await resp.read()
            return web.Response(
                body=body,
                status=resp.status,
                content_type=resp.content_type or "application/json",
            )


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

    hass.http.register_view(GrowattProxyView())

    try:
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name="solar-statistik-panel",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{STATIC_URL_PATH}/ha-panel.js",
            embed_iframe=False,
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
            embed_iframe=False,
            require_admin=False,
        )
    return True


async def async_unload_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True
