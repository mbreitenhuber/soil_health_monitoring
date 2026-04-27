/* ══════════════════════════════════════════════════════
   nav.js — Seiten-Navigation
   
   Neue Seite hinzufügen:
     1. PAGES-Array erweitern:  'kontakt'
     2. HTML:  <div class="page" id="page-kontakt">
     3. Nav:   <div class="nav-link" id="nav-kontakt"
                    onclick="navigate('kontakt')">Kontakt</div>
══════════════════════════════════════════════════════ */

const PAGES = ['home', 'app', 'about'];
// ↑ Neue Seiten hier eintragen, z.B.: ['home', 'app', 'about', 'kontakt']

function navigate(target) {
  PAGES.forEach(id => {
    document.getElementById('page-' + id)?.classList.remove('active');
    document.getElementById('nav-'  + id)?.classList.remove('active');
  });

  document.getElementById('page-' + target)?.classList.add('active');
  document.getElementById('nav-'  + target)?.classList.add('active');

  // Leaflet-Karte nach Seiten-Wechsel neu berechnen
  if (target === 'app' && window._map) {
    setTimeout(() => window._map.invalidateSize(), 100);
  }
}
