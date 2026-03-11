// Talento PyME
// IMPORTANTE: no poner secretos en el frontend.
//
// Este archivo se carga tanto en el navegador (window) como en el Service Worker (self).
// Así mantenemos una única fuente de verdad para:
// - URL oficial de la API
// - Versión visible en la UI
// - Versión del cache del PWA
const TP_GLOBAL = (typeof self !== "undefined") ? self : window;

TP_GLOBAL.TP_API_URL = "https://talento-pyme-api.onrender.com";
TP_GLOBAL.TP_APP_VERSION = "5.5.16";
TP_GLOBAL.TP_BUILD_ID = "20260311_03";

TP_GLOBAL.API_BASE = TP_GLOBAL.TP_API_URL;
